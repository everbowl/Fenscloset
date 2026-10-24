import { db } from "@/lib/db";
import { startJob, type Job } from "@/lib/jobs";
import { canShopFor, type Viewer } from "@/lib/people/visibility";
import { getRuleNumber } from "@/lib/rules";
import { ShopError } from "@/lib/shop/engine";
import { searchProducts, type Product } from "@/lib/shop/products";
import { mergeMatches, type Match, type StoredMatch } from "@/lib/shop/wants";

/**
 * "New from your brands" (Jeff, 23 Oct 2026, Shop v2 item 3: "suggest items from my favorite brands"). One feed per
 * person, built from their favorite brands (Profile → My brands): one store search per brand, interleaved so every
 * brand gets a turn, the person's stores first. Fetched in the background when the Shop opens and the feed is older
 * than the schedule (Admin → Rules, wantSweepHours) or the brand list changed, and on the same sweep as Looking-for.
 * A product not seen before is new until the Shop is opened.
 */

export type BrandFeedView = {
  personId: string; brands: string[]; products: Match[]; newCount: number; lastFetchedAt: Date | null;
  /** Never fetched, older than the schedule, or the brand list changed: the Shop refreshes it in the background. */
  stale: boolean;
};

/** Products kept in the feed, newest first. */
export const MAX_FEED = 24;
/** Each brand's search returns up to this many. */
const PER_BRAND = 6;
const MAX_BRANDS = 6;
const FRESH_HOURS = 1;
const DEFAULT_SWEEP_HOURS = 24;

async function favorites(personId: string) {
  const p = await db.person.findUniqueOrThrow({ where: { id: personId }, select: { favoriteBrands: { where: { isArchived: false }, orderBy: { name: "asc" }, select: { name: true } }, favoriteStores: { where: { isArchived: false }, select: { name: true } } } });
  return { brands: p.favoriteBrands.map((b) => b.name).slice(0, MAX_BRANDS), stores: p.favoriteStores.map((s) => s.name) };
}

/** Each brand's results take turns so the row is not all one brand. */
export function interleave(lists: Product[][]): Product[] {
  const out: Product[] = [];
  const seen = new Set<string>();
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) { const p = l[i]; if (p && !seen.has(p.url)) { seen.add(p.url); out.push(p); } }
  return out;
}

/** Search the stores for each favorite brand and fold what is new into the feed. `maxAgeHours`: how old a cached store answer may be. */
export async function refreshBrandFeed(personId: string, opts: { maxAgeHours?: number } = {}): Promise<{ added: number; brands: string[] }> {
  const { brands, stores } = await favorites(personId);
  const prefs = { favoriteStores: stores, favoriteBrands: brands };
  const lists = await Promise.all(brands.map((b) => searchProducts([`${b} new arrivals`], prefs, fetch, { maxAgeHours: opts.maxAgeHours, limit: PER_BRAND })));
  const found = interleave(lists);
  const now = new Date();
  const row = await db.brandFeed.findUnique({ where: { personId } });
  const { matches, added } = mergeMatches((row?.products as StoredMatch[] | null) ?? [], found, null, now);
  const products = matches.slice(0, MAX_FEED) as object[];
  await db.brandFeed.upsert({ where: { personId }, update: { brands, products, lastFetchedAt: now }, create: { personId, brands, products, lastFetchedAt: now } });
  return { added, brands };
}

/** The refresh as a background job, one per person at a time; the result is the person's id. */
export function startBrandFeedRefresh(viewer: Viewer, personId: string): Job<string> {
  return startJob<string>(["brandfeed", personId].join("|"), viewer.id, async (step) => { step("Checking your brands…"); await refreshBrandFeed(personId, { maxAgeHours: FRESH_HOURS }); return personId; });
}

/** Start a refresh for someone the viewer may shop for. */
export async function refreshBrandFeedNow(viewer: Viewer, personId: string): Promise<Job<string>> {
  if (!(await canShopFor(viewer, personId))) throw new ShopError("You can shop for yourself, your kids, or people who let you.", 403);
  return startBrandFeedRefresh(viewer, personId);
}

function sameBrands(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** The feed as stored, with which products are new since the Shop was last opened and whether it needs a refresh. Null for anyone who may not shop for the person. */
export async function getBrandFeed(viewer: Viewer, personId: string): Promise<BrandFeedView | null> {
  if (!(await canShopFor(viewer, personId))) return null;
  const [{ brands }, row, hours] = await Promise.all([favorites(personId), db.brandFeed.findUnique({ where: { personId } }), getRuleNumber("wantSweepHours", DEFAULT_SWEEP_HOURS)]);
  const since = row?.seenAt?.getTime() ?? 0;
  const products = ((row?.products as StoredMatch[] | null) ?? []).map((m) => ({ ...m, isNew: new Date(m.firstSeenAt).getTime() > since }));
  const age = row?.lastFetchedAt ? Date.now() - row.lastFetchedAt.getTime() : Infinity;
  const stale = brands.length > 0 && (!row?.lastFetchedAt || !sameBrands(row.brands, brands) || (hours > 0 && age > hours * 3600 * 1000));
  return { personId, brands, products, newCount: products.filter((m) => m.isNew).length, lastFetchedAt: row?.lastFetchedAt ?? null, stale };
}

/** The feed as the Shop opens it: what is new is worked out first, then it is marked seen. */
export async function openBrandFeed(viewer: Viewer, personId: string): Promise<BrandFeedView | null> {
  const view = await getBrandFeed(viewer, personId);
  if (!view) return null;
  if (view.newCount > 0) await db.brandFeed.update({ where: { personId }, data: { seenAt: new Date() } });
  return view;
}

/** The schedule: every person with favorite brands whose feed is older than the rule (0 = off) is refreshed, one at a time. */
export async function sweepBrandFeeds(now = new Date(), log: (line: string) => void = console.log): Promise<{ refreshed: number; added: number; failed: number }> {
  const hours = await getRuleNumber("wantSweepHours", DEFAULT_SWEEP_HOURS);
  const out = { refreshed: 0, added: 0, failed: 0 };
  if (hours <= 0) return out;
  const people = await db.person.findMany({ where: { status: { not: "removed" }, favoriteBrands: { some: { isArchived: false } } }, select: { id: true, name: true, brandFeed: { select: { lastFetchedAt: true } } } });
  const cutoff = now.getTime() - hours * 3600 * 1000;
  for (const p of people) {
    const last = p.brandFeed?.lastFetchedAt?.getTime();
    if (last && last >= cutoff) continue;
    try {
      const r = await refreshBrandFeed(p.id, { maxAgeHours: FRESH_HOURS });
      out.refreshed++; out.added += r.added;
      if (r.added) log(`brand feed: ${r.added} new from ${r.brands.join(", ")} for ${p.name.split(" ")[0]}`);
    } catch (e) {
      out.failed++;
      console.error(`brand feed: refresh failed for ${p.name}`, e);
    }
  }
  if (out.refreshed) log(`brand feed: refreshed ${out.refreshed}, ${out.added} new${out.failed ? `, ${out.failed} failed` : ""}`);
  return out;
}

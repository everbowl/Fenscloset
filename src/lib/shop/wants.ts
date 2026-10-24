import { db } from "@/lib/db";
import { isMockAi, structured } from "@/lib/ai/claude";
import { startJob, type Job } from "@/lib/jobs";
import { canShopFor, type Viewer } from "@/lib/people/visibility";
import { getRuleNumber } from "@/lib/rules";
import { ShopError, type LookupHooks } from "@/lib/shop/engine";
import { priceDollars, searchProducts, type Product } from "@/lib/shop/products";

/**
 * "Looking for" (Jeff, 23 Oct 2026, Shop v2 item 2: "state what I'm looking for so the shopping tool lets me know").
 * A person types one line about something they want to buy. Claude turns it into store searches (never sizes or
 * measurements), the stores are searched right away in the background, and again on a schedule (Admin → Rules,
 * wantSweepHours; the sweep is started from instrumentation.ts). Every product not seen before is a match and
 * counts as new until the person opens the want; the Shop and Today say how many are new. The list belongs to the
 * person it is for, so the asker must be allowed to shop for them. "Found it" keeps the row but retires it.
 */

export type Match = Product & { firstSeenAt: string; /** Found since the person last opened this want. */ isNew: boolean };

export type WantView = {
  id: string; forPersonId: string; forName: string; askedById: string;
  text: string; category: string | null; maxPrice: number | null; queries: string[];
  matches: Match[]; newCount: number; lastSearchedAt: Date | null; seenAt: Date | null; foundAt: Date | null; createdAt: Date;
};

/** Matches kept per want, newest first. */
export const MAX_MATCHES = 30;
/** A search asked for by hand, or by the sweep, reuses a store answer only this old (the Shop's usual cache is a day). */
const FRESH_HOURS = 1;
const DEFAULT_SWEEP_HOURS = 24;

export type StoredMatch = Product & { firstSeenAt: string };
type Parsed = { queries: string[]; category: string | null; maxPrice: number | null };

async function access(viewer: Viewer, row: { askedById: string; forPersonId: string }): Promise<boolean> {
  return row.askedById === viewer.id || canShopFor(viewer, row.forPersonId);
}

/** "under $200", "less than 150", "$80 max", "up to $60" → the whole dollars, else null. */
export function priceCapOf(text: string): number | null {
  const m = text.match(/\b(?:under|below|less than|up to|max(?:imum)?|no more than|at most|<)\s*\$?\s*(\d{1,5})\b/i) ?? text.match(/\$\s?(\d{1,5})\s*(?:max|or less|and under|tops|cap)\b/i);
  return m ? Number(m[1]) : null;
}

/** What the person typed without the price words, as a plain search. */
function plainQuery(text: string): string {
  return text
    .replace(/\b(?:under|below|less than|up to|max(?:imum)?|no more than|at most|<)\s*\$?\s*\d{1,5}\b/gi, "")
    .replace(/\$\s?\d{1,5}\s*(?:max|or less|and under|tops|cap)\b/gi, "")
    .replace(/\s+/g, " ").replace(/[,;:]+$/, "").trim().toLowerCase();
}

function mockParse(text: string): Parsed {
  const t = text.toLowerCase();
  const category = /jean|pant|trouser|short|skirt|chino/.test(t) ? "Bottoms" : /shoe|sneaker|boot|loafer|sandal/.test(t) ? "Shoes" : /jacket|coat|blazer|parka/.test(t) ? "Outerwear" : /dress|gown/.test(t) ? "Dresses" : "Tops";
  const base = plainQuery(text) || "clothes";
  return { queries: [base, `${base} new arrival`], category, maxPrice: priceCapOf(text) };
}

/** Claude turns the line into 1–3 Google Shopping searches, a category and a price cap. */
async function parseWant(text: string, forName: string, brands: string[]): Promise<Parsed> {
  if (isMockAi()) return mockParse(text);
  const schema = {
    type: "object",
    properties: {
      queries: { type: "array", items: { type: "string" }, description: "1 to 3 Google Shopping searches that would find what they want: keep their words for color, material, fit, style and brand; add who it is for (men's / women's / girls') when the line implies it; never a size, a measurement or a price. The first search is the closest to what they typed." },
      category: { anyOf: [{ type: "string", enum: ["Tops", "Bottoms", "Dresses", "Outerwear", "Shoes", "Accessories", "Other"] }, { type: "null" }] },
      maxPrice: { anyOf: [{ type: "number" }, { type: "null" }], description: "The most they said they would pay, in whole US dollars, or null when they did not say." },
    },
    required: ["queries", "category", "maxPrice"], additionalProperties: false,
  };
  const out = await structured<Parsed>({
    system: "You are a personal shopper for one family's private closet app. One line a person typed about something they want to buy becomes store searches.",
    prompt: [`The line, typed for ${forName}: "${text}"`, brands.length ? `Their favorite brands: ${brands.join(", ")}. A search may name one when it fits.` : "No favorite brands set."].join("\n\n"),
    schema, effort: "low", maxTokens: 300,
  });
  const queries = (out.queries ?? []).map((q) => q.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3);
  return { queries: queries.length ? queries : [plainQuery(text) || text], category: out.category ?? null, maxPrice: out.maxPrice && out.maxPrice > 0 ? Math.round(out.maxPrice) : priceCapOf(text) };
}

/** Everything the stores returned that is not known yet, under the cap, becomes a new match in front of the old ones. */
export function mergeMatches(existing: StoredMatch[], found: Product[], maxPrice: number | null, now = new Date()): { matches: StoredMatch[]; added: number } {
  const known = new Set(existing.map((m) => m.url));
  const fresh = found.filter((p) => !known.has(p.url) && (maxPrice == null || (priceDollars(p.priceText) ?? 0) <= maxPrice)).map((p) => ({ ...p, firstSeenAt: now.toISOString() }));
  return { matches: [...fresh, ...existing].slice(0, MAX_MATCHES), added: fresh.length };
}

async function prefsFor(personId: string) {
  const person = await db.person.findUniqueOrThrow({ where: { id: personId }, select: { name: true, favoriteStores: { where: { isArchived: false }, select: { name: true } }, favoriteBrands: { where: { isArchived: false }, select: { name: true } } } });
  return { name: person.name.split(" ")[0], favoriteStores: person.favoriteStores.map((s) => s.name), favoriteBrands: person.favoriteBrands.map((b) => b.name) };
}

/**
 * Search the stores for one want: the first time Claude writes the searches; every time, what is new goes in front and
 * is counted. `maxAgeHours` is how old a cached store answer may be (the sweep and Search now ask for fresh).
 */
export async function searchWant(wantId: string, hooks: LookupHooks & { maxAgeHours?: number } = {}): Promise<{ added: number }> {
  const step = (s: string) => hooks.step?.(s);
  const row = await db.want.findUnique({ where: { id: wantId } });
  if (!row) throw new ShopError("That one is gone from the list.", 404);
  const prefs = await prefsFor(row.forPersonId);
  let { queries, category, maxPrice } = row;
  if (!queries.length) {
    step("Reading what you want…");
    const parsed = await parseWant(row.text, prefs.name, prefs.favoriteBrands);
    queries = parsed.queries; category = parsed.category; maxPrice = parsed.maxPrice;
  }
  step("Searching the stores…");
  const found = await searchProducts(queries, prefs, fetch, { maxAgeHours: hooks.maxAgeHours, limit: MAX_MATCHES });
  const now = new Date();
  const { matches, added } = mergeMatches((row.matches as StoredMatch[] | null) ?? [], found, maxPrice, now);
  await db.want.update({ where: { id: wantId }, data: { queries, category, maxPrice, matches: matches as object[], newCount: row.newCount + added, lastSearchedAt: now } });
  return { added };
}

/** The search as a background job (src/lib/jobs.ts), one per want at a time; its result is the want's id. */
export function startWantSearch(viewer: Viewer, wantId: string, fresh: boolean): Job<string> {
  return startJob<string>(["want", wantId].join("|"), viewer.id, async (step) => { await searchWant(wantId, { step, maxAgeHours: fresh ? FRESH_HOURS : undefined }); return wantId; });
}

/** Add a line to someone's list and start searching for it. The row exists at once; the job fills it in. */
export async function addWant(viewer: Viewer, forPersonId: string, text: string): Promise<{ id: string; job: Job<string> }> {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 3) throw new ShopError("Say a little more about what you’re after.", 400);
  if (clean.length > 160) throw new ShopError("Keep it under 160 characters.", 400);
  if (!(await canShopFor(viewer, forPersonId))) throw new ShopError("You can keep a list for yourself, your kids, or people who let you shop for them.", 403);
  const row = await db.want.create({ data: { forPersonId, askedById: viewer.id, text: clean } });
  return { id: row.id, job: startWantSearch(viewer, row.id, false) };
}

/** Change the line: Claude reads it again and the matches start over. */
export async function editWant(viewer: Viewer, wantId: string, text: string): Promise<Job<string>> {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 3) throw new ShopError("Say a little more about what you’re after.", 400);
  if (clean.length > 160) throw new ShopError("Keep it under 160 characters.", 400);
  const row = await db.want.findUnique({ where: { id: wantId } });
  if (!row || !(await access(viewer, row))) throw new ShopError("That one is gone from the list.", 404);
  await db.want.update({ where: { id: wantId }, data: { text: clean, queries: [], category: null, maxPrice: null, matches: [], newCount: 0, seenAt: null, lastSearchedAt: null } });
  return startWantSearch(viewer, wantId, true);
}

/** Search now, by hand. */
export async function searchWantNow(viewer: Viewer, wantId: string): Promise<Job<string>> {
  const row = await db.want.findUnique({ where: { id: wantId }, select: { askedById: true, forPersonId: true } });
  if (!row || !(await access(viewer, row))) throw new ShopError("That one is gone from the list.", 404);
  return startWantSearch(viewer, wantId, true);
}

/** "Found it" retires the line (kept under Found); `found: false` puts it back on the list. */
export async function setWantFound(viewer: Viewer, wantId: string, found: boolean): Promise<void> {
  const row = await db.want.findUnique({ where: { id: wantId }, select: { askedById: true, forPersonId: true } });
  if (!row || !(await access(viewer, row))) throw new ShopError("That one is gone from the list.", 404);
  await db.want.update({ where: { id: wantId }, data: { foundAt: found ? new Date() : null, newCount: 0 } });
}

export async function deleteWant(viewer: Viewer, wantId: string): Promise<void> {
  const row = await db.want.findUnique({ where: { id: wantId }, select: { askedById: true, forPersonId: true } });
  if (!row || !(await access(viewer, row))) throw new ShopError("That one is gone from the list.", 404);
  await db.want.delete({ where: { id: wantId } });
}

type Row = NonNullable<Awaited<ReturnType<typeof db.want.findUnique>>> & { forPerson: { name: string } };

function toView(row: Row): WantView {
  const since = row.seenAt?.getTime() ?? 0;
  const matches = ((row.matches as StoredMatch[] | null) ?? []).map((m) => ({ ...m, isNew: new Date(m.firstSeenAt).getTime() > since }));
  return {
    id: row.id, forPersonId: row.forPersonId, forName: row.forPerson.name.split(" ")[0], askedById: row.askedById,
    text: row.text, category: row.category, maxPrice: row.maxPrice, queries: row.queries,
    matches, newCount: row.newCount, lastSearchedAt: row.lastSearchedAt, seenAt: row.seenAt, foundAt: row.foundAt, createdAt: row.createdAt,
  };
}

export async function getWant(viewer: Viewer, wantId: string): Promise<WantView | null> {
  const row = await db.want.findUnique({ where: { id: wantId }, include: { forPerson: { select: { name: true } } } });
  if (!row || !(await access(viewer, row))) return null;
  return toView(row);
}

/** The want as the person opens it: which matches are new is worked out first, then it is marked seen. */
export async function openWant(viewer: Viewer, wantId: string): Promise<WantView | null> {
  const view = await getWant(viewer, wantId);
  if (!view) return null;
  if (view.newCount > 0 || !view.seenAt) await db.want.update({ where: { id: wantId }, data: { newCount: 0, seenAt: new Date() } });
  return view;
}

/** Someone's list, open ones first (newest first), then what was found. */
export async function listWants(viewer: Viewer, forPersonId: string): Promise<WantView[]> {
  if (!(await canShopFor(viewer, forPersonId))) return [];
  const rows = await db.want.findMany({ where: { forPersonId }, include: { forPerson: { select: { name: true } } }, orderBy: [{ foundAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }] });
  return rows.map(toView);
}

/** How many new matches wait on someone's open wants (the Shop's and Today's line). Zero for anyone who may not shop for them. */
export async function newMatchCount(viewer: Viewer, forPersonId: string): Promise<{ wants: number; newMatches: number }> {
  if (!(await canShopFor(viewer, forPersonId))) return { wants: 0, newMatches: 0 };
  const rows = await db.want.findMany({ where: { forPersonId, foundAt: null }, select: { newCount: true } });
  return { wants: rows.length, newMatches: rows.reduce((n, r) => n + r.newCount, 0) };
}

/**
 * The schedule: every open want whose last search is older than the rule (wantSweepHours; 0 = off) is searched again,
 * one at a time. Returns what it did, for the log and tests.
 */
export async function sweepWants(now = new Date(), log: (line: string) => void = console.log): Promise<{ searched: number; added: number; failed: number }> {
  const hours = await getRuleNumber("wantSweepHours", DEFAULT_SWEEP_HOURS);
  const out = { searched: 0, added: 0, failed: 0 };
  if (hours <= 0) return out;
  const due = await db.want.findMany({ where: { foundAt: null, OR: [{ lastSearchedAt: null }, { lastSearchedAt: { lt: new Date(now.getTime() - hours * 3600 * 1000) } }] }, select: { id: true, text: true }, orderBy: { createdAt: "asc" } });
  for (const w of due) {
    try {
      const r = await searchWant(w.id, { maxAgeHours: FRESH_HOURS });
      out.searched++; out.added += r.added;
      if (r.added) log(`looking for: ${r.added} new for "${w.text}"`);
    } catch (e) {
      out.failed++;
      console.error(`looking for: search failed for "${w.text}"`, e);
    }
  }
  if (out.searched) log(`looking for: searched ${out.searched}, ${out.added} new${out.failed ? `, ${out.failed} failed` : ""}`);
  return out;
}

/** Started once when the server starts (src/instrumentation.ts): the Looking-for sweep and the brand feeds soon after start, then every `everyMs`. */
export async function wantsOnStart(delayMs = 20_000, everyMs = 30 * 60_000): Promise<void> {
  const unref = (t: ReturnType<typeof setTimeout>) => (t as { unref?: () => void }).unref?.();
  await new Promise<void>((resolve) => unref(setTimeout(resolve, delayMs)));
  const { sweepBrandFeeds } = await import("@/lib/shop/brand-feed");
  const run = async () => {
    try { await sweepWants(); } catch (e) { console.error("looking for: sweep failed", e); }
    try { await sweepBrandFeeds(); } catch (e) { console.error("brand feed: sweep failed", e); }
  };
  await run();
  unref(setInterval(run, everyMs));
}

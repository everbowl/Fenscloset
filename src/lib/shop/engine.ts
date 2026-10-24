import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { startJob, type Job } from "@/lib/jobs";
import { isMockAi, structured } from "@/lib/ai/claude";
import { loadTagLists, type TagLists } from "@/lib/ai/tag-item";
import { newKey, putObject, deleteObject } from "@/lib/storage";
import { normalizeOriginal, toAiImage } from "@/lib/images/thumb";
import { canSeeBodyData, canShopFor, type Viewer } from "@/lib/people/visibility";
import { loadCandidates, styleContext, type Candidate } from "@/lib/outfits/catalog";
import { composeLooks, type Board, type Piece } from "@/lib/outfits/engine";
import { fetchImage, PageError, readProductPage } from "@/lib/shop/page";
import { searchProducts, type Product } from "@/lib/shop/products";
import type { ShopSource } from "@/generated/prisma/client";

/**
 * "Should I buy this?" (screen 15). The shopper may be the person themselves, a parent of a minor, or someone granted
 * shop-for access. Body data (sizes, measurements, fit notes) is used only when the shopper may see it.
 */

export class ShopError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ShopError";
  }
}

export type CandidateRead = { name: string; categoryId: string | null; categoryName: string | null; colorIds: string[]; colorNames: string[]; fabricName: string | null; formalityName: string | null; brandText: string | null; sizeText: string | null };
/** shoppingQueries: 1–3 Google Shopping searches for the missing category (or a better alternative on PASS); empty otherwise. */
export type Verdict = { call: "FITS" | "RISKY" | "PASS"; reason: string; sizeNote: string | null; missingCategory: string | null; shoppingQueries: string[]; usedBodyData: boolean };
export type Recommendation = { label: string; storeName: string; url: string };
export type SimilarItem = { id: string; name: string; thumbKey: string | null };

export type LookupView = {
  id: string; source: ShopSource; createdAt: Date; shopperId: string; forPersonId: string; forName: string;
  inputUrl: string | null; imageKey: string | null; title: string | null; priceText: string | null; brandText: string | null;
  read: CandidateRead; verdict: Verdict; similar: SimilarItem[]; pairings: (Board & { pieces: Piece[] })[]; recommendations: Recommendation[];
  /** Real products (picture, price, store) for the missing category or a better alternative; empty when nothing is needed or search is not set up. */
  products: Product[];
};

const CANDIDATE_ID = "candidate";

async function readCandidate(lists: TagLists, input: { image?: { data: string; mediaType: "image/jpeg" }; title: string | null; description: string | null; brandText: string | null }): Promise<CandidateRead> {
  const cats = lists.categories.map((c) => c.name);
  if (isMockAi()) {
    const cat = lists.categories.find((c) => c.name === "Outerwear") ?? lists.categories[0];
    const color = lists.colors.find((c) => /beige|cream|tan|oat/i.test(c.name)) ?? lists.colors[0];
    return { name: input.title ?? "New piece", categoryId: cat?.id ?? null, categoryName: cat?.name ?? null, colorIds: color ? [color.id] : [], colorNames: color ? [color.name] : [], fabricName: "Linen", formalityName: "Smart casual", brandText: input.brandText, sizeText: null };
  }
  const schema = {
    type: "object",
    properties: {
      name: { type: "string" }, category: { type: "string", enum: [...cats, "unknown"] },
      colors: { type: "array", items: { type: "string", enum: lists.colors.map((c) => c.name) }, description: "At most three, dominant first." },
      fabric: { type: "string", enum: [...lists.fabrics.map((f) => f.name), "unknown"] },
      formality: { type: "string", enum: [...lists.formalities.map((f) => f.name), "unknown"] },
      brandText: { type: ["string", "null"] }, sizeText: { type: ["string", "null"] },
    },
    required: ["name", "category", "colors", "fabric", "formality", "brandText", "sizeText"], additionalProperties: false,
  };
  const out = await structured<{ name: string; category: string; colors: string[]; fabric: string; formality: string; brandText: string | null; sizeText: string | null }>({
    system: "You describe one clothing item a person is thinking of buying, using only the given lists. If a store page title or description is given, trust it for brand and name. Short product name (2–4 words).",
    prompt: [input.title ? `Store title: ${input.title}` : null, input.description ? `Store description: ${input.description}` : null, input.brandText ? `Brand (from the page): ${input.brandText}` : null, input.image ? "A photo is attached." : "No photo."].filter(Boolean).join("\n") || "Describe the item.",
    image: input.image, schema, effort: "low", maxTokens: 400,
  });
  const cat = lists.categories.find((c) => c.name === out.category) ?? null;
  const colors = out.colors.map((n) => lists.colors.find((c) => c.name === n)).filter((c): c is { id: string; name: string } => Boolean(c));
  return { name: out.name.trim() || input.title || "New piece", categoryId: cat?.id ?? null, categoryName: cat?.name ?? null, colorIds: colors.map((c) => c.id), colorNames: colors.map((c) => c.name), fabricName: out.fabric === "unknown" ? null : out.fabric, formalityName: out.formality === "unknown" ? null : out.formality, brandText: out.brandText ?? input.brandText, sizeText: out.sizeText };
}

/** Plan B3: same category and a shared color or fabric, top 4. */
export async function similarOwned(forPersonId: string, read: CandidateRead): Promise<SimilarItem[]> {
  if (!read.categoryId) return [];
  const items = await db.item.findMany({
    where: { ownerId: forPersonId, categoryId: read.categoryId, retiredAt: null, OR: [{ colors: { some: { id: { in: read.colorIds } } } }, ...(read.fabricName ? [{ fabrics: { some: { name: read.fabricName } } }] : [])] },
    orderBy: { wearCount: "desc" }, take: 4,
    select: { id: true, name: true, photos: { where: { kind: "thumb" }, take: 1, select: { bucketKey: true } } },
  });
  return items.map((it) => ({ id: it.id, name: it.name ?? "Untitled piece", thumbKey: it.photos[0]?.bucketKey ?? null }));
}

async function bodyContext(viewer: Viewer, forPersonId: string, brandText: string | null): Promise<{ text: string; used: boolean }> {
  if (!(await canSeeBodyData(viewer, forPersonId))) return { text: "", used: false };
  const [sizes, measurements, profile] = await Promise.all([
    db.bodySizeByBrand.findMany({ where: { personId: forPersonId }, include: { brand: true } }),
    db.bodyMeasurement.findMany({ where: { personId: forPersonId }, include: { kind: true } }),
    db.bodyProfile.findUnique({ where: { personId: forPersonId } }),
  ]);
  const lines = [
    sizes.length ? `Sizes by brand: ${sizes.map((s) => `${s.brand.name} ${s.size}`).join(", ")}${brandText && sizes.some((s) => s.brand.name.toLowerCase() === brandText.toLowerCase()) ? ` (this brand is on the list)` : ""}` : null,
    measurements.length ? `Measurements: ${measurements.map((m) => `${m.kind.name} ${m.value} ${m.kind.unit}`).join(", ")}` : null,
    profile?.fitNotes ? `Fit notes: ${profile.fitNotes}` : null,
  ].filter(Boolean);
  return { text: lines.join("\n"), used: lines.length > 0 };
}

async function decide(read: CandidateRead, style: string, body: { text: string; used: boolean }, closet: Candidate[], similar: SimilarItem[], priceText: string | null): Promise<Verdict> {
  const counts = new Map<string, number>();
  for (const c of closet) counts.set(c.category ?? "?", (counts.get(c.category ?? "?") ?? 0) + 1);
  if (isMockAi()) {
    const call = similar.length >= 2 ? "PASS" : counts.get("Bottoms") ? "FITS" : "RISKY";
    const missingCategory = counts.get("Bottoms") ? null : "Bottoms";
    const shoppingQueries = missingCategory ? ["men's slim dark wash jeans", "men's tapered chino pants"] : call === "PASS" ? ["men's navy unstructured blazer"] : [];
    return { call, reason: call === "PASS" ? "You already own two like it." : call === "FITS" ? "Mock: it pairs with the jeans you wear most." : "Mock: nothing in the closet to wear it with yet.", sizeNote: body.used ? "Mock: size M by your Everlane size." : null, missingCategory, shoppingQueries, usedBodyData: body.used };
  }
  const schema = { type: "object", properties: { call: { type: "string", enum: ["FITS", "RISKY", "PASS"] }, reason: { type: "string" }, sizeNote: { type: ["string", "null"] }, missingCategory: { anyOf: [{ type: "string", enum: [...new Set([...closet.map((c) => c.category).filter((x): x is string => Boolean(x)), "Tops", "Bottoms", "Shoes", "Outerwear", "Dresses"])] }, { type: "null" }] }, shoppingQueries: { type: "array", items: { type: "string" }, description: "1 to 3 Google Shopping searches, only when missingCategory is set (things to wear with it) or the call is PASS (a better alternative); otherwise empty. Specific and buyable: who it is for, fit, color, material, e.g. \"men's black tapered chino pants\". Never sizes or measurements." } }, required: ["call", "reason", "sizeNote", "missingCategory", "shoppingQueries"], additionalProperties: false };
  const out = await structured<Verdict>({
    system: `You are a candid personal shopper for one family's private closet app. Judge ONE candidate piece for ONE person.
FITS = buy it: it suits their style, fills a gap or pairs with what they own. RISKY = maybe: fit or style doubts, say why. PASS = skip: duplicates what they own or clashes with their style.
Reason: one sentence, max 22 words, warm and specific. sizeNote: a size suggestion only when sizes-by-brand or measurements support it, else null. missingCategory: the category they'd need to wear it (e.g. Bottoms) or null.
shoppingQueries: when missingCategory is set, 1–3 shopping searches for pieces in that category that go with the candidate and the style profile; when the call is PASS, 1–2 searches for a better alternative; otherwise an empty list. Favorite brands may appear in a query. Never put sizes or measurements in a query.`,
    prompt: [
      `Candidate: ${read.name}; category ${read.categoryName ?? "unknown"}; colors ${read.colorNames.join(", ") || "unknown"}; fabric ${read.fabricName ?? "unknown"}; formality ${read.formalityName ?? "unknown"}; brand ${read.brandText ?? "unknown"}${priceText ? `; price ${priceText}` : ""}.`,
      style ? `Style profile:\n${style}` : "Style profile: none set.",
      body.text ? `Body (private, use for size only):\n${body.text}` : "Body data: not available to this shopper; judge on style and closet only.",
      `Closet by category: ${[...counts.entries()].map(([k, v]) => `${k} ${v}`).join(", ") || "empty"}.`,
      similar.length ? `Already owns similar: ${similar.map((s) => s.name).join(", ")}.` : "Owns nothing similar.",
    ].join("\n\n"),
    schema, effort: "medium", maxTokens: 400,
  });
  return { ...out, shoppingQueries: (out.shoppingQueries ?? []).slice(0, 3), usedBodyData: body.used };
}

/** Plan B5b: real products for the verdict's shopping queries, favorite stores and brands first. */
async function findProducts(forPersonId: string, verdict: Verdict): Promise<Product[]> {
  if (!verdict.shoppingQueries.length) return [];
  const person = await db.person.findUniqueOrThrow({ where: { id: forPersonId }, select: { favoriteStores: { where: { isArchived: false }, select: { name: true } }, favoriteBrands: { where: { isArchived: false }, select: { name: true } } } });
  return searchProducts(verdict.shoppingQueries, { favoriteStores: person.favoriteStores.map((s) => s.name), favoriteBrands: person.favoriteBrands.map((b) => b.name) });
}

/** Plan B4: three looks with the candidate pinned as hero. */
async function pairings(forPersonId: string, read: CandidateRead, imageKey: string | null, closet: Candidate[], style: string): Promise<(Board & { pieces: Piece[] })[]> {
  const cand: Candidate = { id: CANDIDATE_ID, name: read.name, ownerId: forPersonId, category: read.categoryName, subcategory: null, colors: read.colorNames, pattern: null, fabric: read.fabricName, seasons: [], formality: read.formalityName, occasions: [], brand: read.brandText, isFavorite: false, wearCount: 0, lastWornAt: null, thumbKey: imageKey };
  const others = closet.filter((c) => c.category !== read.categoryName || c.category == null);
  if (others.length < 1) return [];
  const boards = await composeLooks({ cands: [cand, ...others], inputs: { weather: null, plan: { label: null, source: "none" }, checkIn: [], restingIds: [], noRepeatDays: 0 }, style, count: 3, extra: `Piece #1 "${read.name}" is the NEW piece being considered: every look must include #1 and list it first.` });
  const byId = new Map<string, Candidate>([cand, ...others].map((c) => [c.id, c]));
  return boards.map((b) => {
    const ids = [CANDIDATE_ID, ...b.itemIds.filter((id) => id !== CANDIDATE_ID)];
    return { itemIds: ids, reason: b.reason, pieces: ids.map((id) => byId.get(id)).filter((c): c is Candidate => Boolean(c)).map((c) => ({ id: c.id, name: c.name, label: (c.subcategory ?? c.category ?? "piece").toUpperCase(), thumbKey: c.thumbKey, ownerId: c.ownerId })) };
  });
}

/** Plan B5: up to 3 search links on the person's favorite stores (fallback: any store with a URL). */
async function recommend(forPersonId: string, read: CandidateRead, verdict: Verdict): Promise<Recommendation[]> {
  if (verdict.call !== "PASS" && !verdict.missingCategory) return [];
  const person = await db.person.findUniqueOrThrow({ where: { id: forPersonId }, select: { favoriteStores: { where: { isArchived: false } }, favoriteBrands: { where: { isArchived: false }, take: 3 } } });
  const fallback = await db.store.findMany({ where: { isArchived: false }, orderBy: [{ url: { sort: "desc", nulls: "last" } }, { sortOrder: "asc" }], take: 3 });
  const stores: { name: string; url: string | null }[] = person.favoriteStores.length ? person.favoriteStores : fallback.length ? fallback : [{ name: "Google", url: null }];
  const want = verdict.missingCategory ?? read.categoryName ?? "clothes";
  const brandWords = person.favoriteBrands.map((b) => b.name);
  const queries = verdict.missingCategory
    ? [`${want} to wear with ${read.name}`, ...brandWords.slice(0, 2).map((b) => `${b} ${want}`)]
    : [`${read.colorNames[0] ?? ""} ${read.categoryName ?? want} alternative`.trim(), ...brandWords.slice(0, 2).map((b) => `${b} ${read.categoryName ?? want}`)];
  const out: Recommendation[] = [];
  for (let i = 0; i < 3; i++) {
    const store = stores[i % stores.length];
    const q = (queries[i] ?? queries[0]).trim();
    if (!q) break;
    const base = store.url?.replace(/\/$/, "");
    const url = base ? `${base}/search?q=${encodeURIComponent(q)}` : `https://www.google.com/search?q=${encodeURIComponent(store.name === "Google" ? q : `${store.name} ${q}`)}`;
    out.push({ label: q.replace(/\s+/g, " ").replace(/^\w/, (c) => c.toUpperCase()), storeName: store.name, url });
  }
  return out;
}

export async function assertCanShop(viewer: Viewer, forPersonId: string) {
  if (!(await canShopFor(viewer, forPersonId))) throw new ShopError("You can shop for yourself, your kids, or people who let you.", 403);
}

export type LookupInput = { source: "link"; url: string } | { source: "screenshot" | "photo"; data: Buffer; contentType: "image/jpeg" | "image/png" | "image/webp" };
export type LookupHooks = { step?: (s: string) => void };

/** Dev and tests: a pause after each step of a mock lookup, so the progress line can be seen and tested. Unset in production. */
async function slowStep(): Promise<void> {
  const ms = Number(process.env.MOCK_SHOP_SLOW_MS ?? 0);
  if (ms > 0 && isMockAi()) await new Promise((r) => setTimeout(r, ms));
}

/** Run a lookup end to end and store it. `hooks.step` hears each stage, for a progress line while it runs in the background. */
export async function lookup(viewer: Viewer, forPersonId: string, input: LookupInput, hooks: LookupHooks = {}): Promise<LookupView> {
  const step = async (s: string) => { hooks.step?.(s); await slowStep(); };
  await assertCanShop(viewer, forPersonId);
  let title: string | null = null, description: string | null = null, priceText: string | null = null, brandText: string | null = null, inputUrl: string | null = null;
  let image: { data: Buffer; contentType: string } | null = null;
  if (input.source === "link") {
    await step("Reading the store page…");
    const page = await readProductPage(input.url).catch((e) => { if (e instanceof PageError) throw new ShopError(e.message); throw e; });
    ({ title, description, priceText, brandText } = page); inputUrl = page.url;
    if (page.imageUrl) image = await fetchImage(page.imageUrl);
  } else {
    image = { data: input.data, contentType: input.contentType };
  }
  let imageKey: string | null = null;
  let ai: { data: string; mediaType: "image/jpeg" } | undefined;
  if (image) {
    const normalized = await normalizeOriginal(image.data);
    imageKey = newKey("shop", viewer.id, "image/jpeg");
    await putObject(imageKey, normalized, "image/jpeg");
    ai = await toAiImage(normalized);
  }
  await step("Looking at the piece…");
  const lists = await loadTagLists();
  const read = await readCandidate(lists, { image: ai, title, description, brandText });
  await step("Judging it…");
  const [style, body, closet, similar] = await Promise.all([styleContext(forPersonId), bodyContext(viewer, forPersonId, read.brandText), loadCandidates(forPersonId, new Date(), { noRepeatDays: 0 }), similarOwned(forPersonId, read)]);
  const verdict = await decide(read, style, body, closet.usable, similar, priceText);
  await step("Finding what to wear with it…");
  const [boards, recommendations, products] = await Promise.all([pairings(forPersonId, read, imageKey, closet.usable, style), recommend(forPersonId, read, verdict), findProducts(forPersonId, verdict)]);
  const row = await db.shoppingLookup.create({
    data: {
      shopperId: viewer.id, forPersonId, source: input.source, inputUrl, imageKey, title: read.name, priceText, brandText: read.brandText,
      verdict: { ...verdict, read } as object, similarItemIds: similar.map((s) => s.id), pairings: boards.map((b) => ({ itemIds: b.itemIds, reason: b.reason })) as object[], recommendations: recommendations as object[], products: products as object[],
    },
  });
  return (await getLookup(viewer, row.id))!;
}

/**
 * The same lookup as a background job (src/lib/jobs.ts), so the Shop answers at once and polls: a store
 * page, two Claude reads, three looks and a product search take 15 to 40 seconds, longer than a phone
 * waits on one request (Jeff, 23 Oct 2026: a 28-second lookup that Safari gave up on). The job's result
 * is the saved lookup's id; the row itself is the record, so the answer is under Recent even when the
 * browser let go. The same input tapped twice joins the running job instead of paying twice.
 */
export function startLookup(viewer: Viewer, forPersonId: string, input: LookupInput): Job<string> {
  const what = input.source === "link" ? input.url.trim().toLowerCase() : createHash("sha1").update(input.data).digest("hex");
  const key = ["shop", viewer.id, forPersonId, input.source, what].join("|");
  return startJob<string>(key, viewer.id, async (step) => (await lookup(viewer, forPersonId, input, { step })).id);
}

export async function getLookup(viewer: Viewer, id: string): Promise<LookupView | null> {
  const row = await db.shoppingLookup.findUnique({ where: { id }, include: { forPerson: { select: { name: true } } } });
  if (!row) return null;
  if (row.shopperId !== viewer.id && !(await canShopFor(viewer, row.forPersonId))) return null;
  const v = row.verdict as Verdict & { read: CandidateRead };
  const boards = row.pairings as Board[];
  const ids = [...new Set(boards.flatMap((b) => b.itemIds).filter((x) => x !== CANDIDATE_ID))];
  const items = await db.item.findMany({ where: { id: { in: [...ids, ...row.similarItemIds] } }, select: { id: true, name: true, ownerId: true, category: { select: { name: true } }, subcategory: { select: { name: true } }, photos: { where: { kind: "thumb" }, take: 1, select: { bucketKey: true } } } });
  const piece = (id: string): Piece | null => {
    if (id === CANDIDATE_ID) return { id, name: row.title ?? "New piece", label: (v.read.categoryName ?? "new").toUpperCase(), thumbKey: row.imageKey, ownerId: row.forPersonId };
    const it = items.find((x) => x.id === id);
    return it ? { id: it.id, name: it.name ?? "Untitled piece", label: (it.subcategory?.name ?? it.category?.name ?? "piece").toUpperCase(), thumbKey: it.photos[0]?.bucketKey ?? null, ownerId: it.ownerId } : null;
  };
  const { read, ...rest } = v;
  const verdict: Verdict = { ...rest, shoppingQueries: rest.shoppingQueries ?? [] };
  return {
    id: row.id, source: row.source, createdAt: row.createdAt, shopperId: row.shopperId, forPersonId: row.forPersonId, forName: row.forPerson.name.split(" ")[0],
    inputUrl: row.inputUrl, imageKey: row.imageKey, title: row.title, priceText: row.priceText, brandText: row.brandText,
    read, verdict,
    similar: row.similarItemIds.map((id) => items.find((x) => x.id === id)).filter(Boolean).map((it) => ({ id: it!.id, name: it!.name ?? "Untitled piece", thumbKey: it!.photos[0]?.bucketKey ?? null })),
    pairings: boards.map((b) => ({ ...b, pieces: b.itemIds.map(piece).filter((p): p is Piece => Boolean(p)) })),
    recommendations: row.recommendations as Recommendation[],
    products: (row.products as Product[] | null) ?? [],
  };
}

export async function listRecent(viewer: Viewer, forPersonId: string): Promise<LookupView[]> {
  const rows = await db.shoppingLookup.findMany({ where: { forPersonId, OR: [{ shopperId: viewer.id }, { forPersonId: viewer.id }] }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true } });
  const out: LookupView[] = [];
  for (const r of rows) { const v = await getLookup(viewer, r.id); if (v) out.push(v); }
  return out;
}

export async function deleteLookup(viewer: Viewer, id: string): Promise<void> {
  const row = await db.shoppingLookup.findUnique({ where: { id } });
  if (!row) return;
  if (row.shopperId !== viewer.id && row.forPersonId !== viewer.id) throw new ShopError("Only the shopper or the person it was for can remove it.", 403);
  await db.shoppingLookup.delete({ where: { id } });
  if (row.imageKey) await deleteObject(row.imageKey).catch(() => {});
}

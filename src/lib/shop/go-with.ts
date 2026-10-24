import { db } from "@/lib/db";
import { isMockAi, structured } from "@/lib/ai/claude";
import { startJob, type Job } from "@/lib/jobs";
import { canShopFor, type Viewer } from "@/lib/people/visibility";
import { candidateSelect, loadCandidates, styleContext, toCandidate, type Candidate } from "@/lib/outfits/catalog";
import { composeLooks, type Board, type Piece } from "@/lib/outfits/engine";
import { ShopError, type LookupHooks } from "@/lib/shop/engine";
import { searchProducts, type Product } from "@/lib/shop/products";

/**
 * "Shop for something to go with it" (Jeff, 23 Oct 2026, Shop v2 item 1): from one piece in the closet, what would
 * complete it (a category and why, from the closet and the style profile), real products for that with the person's
 * stores and brands first, and the looks the closet already makes with the piece. Runs as a background job like the
 * Shop's lookup; the row is the record, so the answer is there when the person comes back. The search is for the
 * piece's owner (their closet, their sizes), so the asker must be allowed to shop for them.
 */

export type GoWithView = {
  id: string; itemId: string; forPersonId: string; forName: string; createdAt: Date;
  piece: Piece;
  needCategory: string | null; reason: string; queries: string[]; products: Product[];
  closetLooks: (Board & { pieces: Piece[] })[];
};

/** A row is reused for this long; "Look again" makes a fresh one. */
const FRESH_HOURS = 24;

const pieceOf = (c: Candidate): Piece => ({ id: c.id, name: c.name, label: (c.subcategory ?? c.category ?? "piece").toUpperCase(), thumbKey: c.thumbKey, ownerId: c.ownerId, category: c.category });

async function anchor(viewer: Viewer, itemId: string): Promise<Candidate> {
  const row = await db.item.findUnique({ where: { id: itemId }, select: candidateSelect });
  if (!row) throw new ShopError("That piece isn’t in the closet anymore.", 404);
  if (!(await canShopFor(viewer, row.ownerId))) throw new ShopError("You can shop for yourself, your kids, or people who let you.", 403);
  return toCandidate(row);
}

type Complete = { needCategory: string | null; reason: string; shoppingQueries: string[] };

/** What would complete the piece, and the searches for it. */
async function complete(piece: Candidate, closet: Candidate[], style: string, brands: string[]): Promise<Complete> {
  const counts = new Map<string, number>();
  for (const c of closet) counts.set(c.category ?? "?", (counts.get(c.category ?? "?") ?? 0) + 1);
  const categories = [...new Set([...closet.map((c) => c.category).filter((x): x is string => Boolean(x)), "Tops", "Bottoms", "Shoes", "Outerwear", "Dresses"])].filter((c) => c !== piece.category);
  if (isMockAi()) {
    const need = piece.category === "Tops" ? "Bottoms" : "Tops";
    return { needCategory: need, reason: `Mock: a ${need.toLowerCase()} piece would round out ${piece.name}.`, shoppingQueries: [`men's ${need === "Tops" ? "white oxford shirt" : "slim dark wash jeans"}`, `${brands[0] ?? "Everlane"} ${need.toLowerCase()}`] };
  }
  const schema = {
    type: "object",
    properties: {
      needCategory: { anyOf: [{ type: "string", enum: categories }, { type: "null" }], description: "The one category that would do the most for this piece, or null when the closet already covers it well." },
      reason: { type: "string", description: "One sentence, max 24 words, warm and specific: what to add and why, naming the piece." },
      shoppingQueries: { type: "array", items: { type: "string" }, description: "1 to 3 Google Shopping searches for that category, specific and buyable (who it is for, fit, color, material), e.g. \"men's slim dark wash jeans\". Favorite brands may appear. Never sizes or measurements." },
    },
    required: ["needCategory", "reason", "shoppingQueries"], additionalProperties: false,
  };
  const out = await structured<Complete>({
    system: "You are a candid personal shopper for one family's private closet app. One piece from the closet is being shopped around: say what would complete it and write the searches to find that.",
    prompt: [
      `The piece: ${piece.name}; category ${piece.category ?? "unknown"}; colors ${piece.colors.join(", ") || "unknown"}; pattern ${piece.pattern ?? "none"}; fabric ${piece.fabric ?? "unknown"}; formality ${piece.formality ?? "unknown"}; brand ${piece.brand ?? "unknown"}.`,
      style ? `Style profile:\n${style}` : "Style profile: none set.",
      `Closet by category: ${[...counts.entries()].map(([k, v]) => `${k} ${v}`).join(", ") || "empty"}.`,
      brands.length ? `Favorite brands: ${brands.join(", ")}.` : "No favorite brands set.",
    ].join("\n\n"),
    schema, effort: "medium", maxTokens: 400,
  });
  return { needCategory: out.needCategory ?? null, reason: out.reason, shoppingQueries: (out.shoppingQueries ?? []).slice(0, 3) };
}

/** Run it end to end and store it. */
export async function goWith(viewer: Viewer, itemId: string, hooks: LookupHooks = {}): Promise<GoWithView> {
  const step = (s: string) => hooks.step?.(s);
  const piece = await anchor(viewer, itemId);
  step("Looking at the closet…");
  const [closet, style, person] = await Promise.all([
    loadCandidates(piece.ownerId, new Date(), { noRepeatDays: 0 }),
    styleContext(piece.ownerId),
    db.person.findUniqueOrThrow({ where: { id: piece.ownerId }, select: { favoriteStores: { where: { isArchived: false }, select: { name: true } }, favoriteBrands: { where: { isArchived: false }, select: { name: true } } } }),
  ]);
  const others = closet.usable.filter((c) => c.id !== piece.id);
  const brands = person.favoriteBrands.map((b) => b.name);
  step("Deciding what would complete it…");
  const done = await complete(piece, others, style, brands);
  step("Searching the stores…");
  const [products, looks] = await Promise.all([
    searchProducts(done.shoppingQueries, { favoriteStores: person.favoriteStores.map((s) => s.name), favoriteBrands: brands }),
    others.length ? composeLooks({ cands: [piece, ...others], inputs: { weather: null, plan: { label: null, source: "none" }, checkIn: [], restingIds: [], noRepeatDays: 0 }, style, count: 2, extra: `Piece #1 "${piece.name}" is the one being shopped around: every look must include #1 and list it first.` }) : Promise.resolve([] as Board[]),
  ]);
  const row = await db.goWith.create({
    data: {
      itemId: piece.id, forPersonId: piece.ownerId, askedById: viewer.id, needCategory: done.needCategory, reason: done.reason, queries: done.shoppingQueries,
      products: products as object[], closetLooks: looks.map((b) => ({ itemIds: [piece.id, ...b.itemIds.filter((id) => id !== piece.id)], reason: b.reason })) as object[],
    },
  });
  return (await getGoWith(viewer, row.id))!;
}

export async function getGoWith(viewer: Viewer, id: string): Promise<GoWithView | null> {
  const row = await db.goWith.findUnique({ where: { id }, include: { forPerson: { select: { name: true } } } });
  if (!row) return null;
  if (row.askedById !== viewer.id && !(await canShopFor(viewer, row.forPersonId))) return null;
  const boards = row.closetLooks as Board[];
  const ids = [...new Set([row.itemId, ...boards.flatMap((b) => b.itemIds)])];
  const items = await db.item.findMany({ where: { id: { in: ids } }, select: candidateSelect });
  const pieces = new Map(items.map((it) => [it.id, pieceOf(toCandidate(it))]));
  const piece = pieces.get(row.itemId);
  if (!piece) return null; // the piece is gone
  return {
    id: row.id, itemId: row.itemId, forPersonId: row.forPersonId, forName: row.forPerson.name.split(" ")[0], createdAt: row.createdAt,
    piece, needCategory: row.needCategory, reason: row.reason, queries: row.queries, products: (row.products as Product[] | null) ?? [],
    closetLooks: boards.map((b) => ({ ...b, pieces: b.itemIds.map((id) => pieces.get(id)).filter((p): p is Piece => Boolean(p)) })),
  };
}

/** The newest answer for this piece that is still fresh, or null. */
export async function latestGoWith(viewer: Viewer, itemId: string): Promise<GoWithView | null> {
  const row = await db.goWith.findFirst({ where: { itemId, createdAt: { gt: new Date(Date.now() - FRESH_HOURS * 3600 * 1000) } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return row ? getGoWith(viewer, row.id) : null;
}

/** The same as a background job (src/lib/jobs.ts); the result is the row's id. Asked twice at once, one job runs. */
export function startGoWith(viewer: Viewer, itemId: string): Job<string> {
  return startJob<string>(["gowith", viewer.id, itemId].join("|"), viewer.id, async (step) => (await goWith(viewer, itemId, { step })).id);
}

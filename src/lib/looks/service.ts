import sharp from "sharp";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { canShopFor, type Viewer } from "@/lib/people/visibility";
import { fetchImage } from "@/lib/shop/page";
import { priceDollars } from "@/lib/shop/products";
import { getObject, newKey, parseKey, putObject } from "@/lib/storage";
import { featuresOf } from "@/lib/tryon/features";
import type { ExtraGarment } from "@/lib/tryon";
import { MAX_LOOK_PIECES, type LookPieceInput, type LookPieceView, type LookSummary, type LookView, type StorePieceInput } from "@/lib/looks/shared";

export { MAX_LOOK_PIECES } from "@/lib/looks/shared";
export type { LookPieceInput, LookPieceView, LookSummary, LookView, StorePieceInput } from "@/lib/looks/shared";

/**
 * Looks (Jeff, 2 Nov 2026, B1): store finds and closet pieces in one look, dressed on the person or the mannequin
 * (src/lib/tryon: the store pictures ride along as extra garments). Each person has at most one open look (no name);
 * "Add to a look" lands there; naming it saves it under Fits → Looks. Whoever may shop for the person (the person, a
 * parent of a minor, a shopper they allowed) may build it.
 */

export class LookError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "LookError";
  }
}

async function assertCanBuild(viewer: Viewer, personId: string) {
  if (!(await canShopFor(viewer, personId))) throw new LookError("Only the person, a parent, or someone they let shop for them can build their look.", 403);
}

const pieceInclude = {
  pieces: { orderBy: { sortOrder: "asc" as const }, include: { item: { select: { id: true, name: true, retiredAt: true, category: { select: { name: true } }, photos: { where: { kind: "thumb" as const }, take: 1, select: { bucketKey: true } } } } } },
};
type PieceRow = Prisma.LookPieceGetPayload<{ include: (typeof pieceInclude)["pieces"]["include"] }>;
type LookRow = Prisma.LookGetPayload<{ include: typeof pieceInclude & { person: { select: { name: true } } } }>;

function pieceView(p: PieceRow): LookPieceView {
  if (p.item) return { id: p.id, kind: "closet", name: p.item.name ?? p.item.category?.name ?? "Piece", thumbKey: p.item.photos[0]?.bucketKey ?? null, imageUrl: null, url: null, storeName: null, priceText: null, category: p.item.category?.name ?? null, itemId: p.item.id };
  return { id: p.id, kind: "store", name: p.title ?? "Store piece", thumbKey: null, imageUrl: p.imageUrl, url: p.url, storeName: p.storeName, priceText: p.priceText, category: p.category, itemId: null };
}

function toView(row: LookRow, canEdit: boolean): LookView {
  const pieces = row.pieces.filter((p) => !p.item || !p.item.retiredAt).map(pieceView);
  const prices = pieces.filter((p) => p.kind === "store").map((p) => priceDollars(p.priceText));
  return {
    id: row.id, personId: row.personId, personName: row.person.name.split(" ")[0], name: row.name, savedAt: row.savedAt, pieces, canEdit,
    toBuy: prices.length, total: prices.length && prices.every((n) => n !== null) ? Math.round(prices.reduce((a, b) => a + (b ?? 0), 0)) : null,
  };
}

/** The look being put together for a person (no name yet), if any. */
export async function openLook(personId: string): Promise<{ id: string; pieces: number } | null> {
  const row = await db.look.findFirst({ where: { personId, savedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true, _count: { select: { pieces: true } } } });
  return row ? { id: row.id, pieces: row._count.pieces } : null;
}

/** The open look, started if there is none. */
export async function openOrStartLook(viewer: Viewer, personId: string): Promise<string> {
  await assertCanBuild(viewer, personId);
  const open = await db.look.findFirst({ where: { personId, savedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  if (open) return open.id;
  return (await db.look.create({ data: { personId, byId: viewer.id }, select: { id: true } })).id;
}

async function lookFor(viewer: Viewer, lookId: string) {
  const row = await db.look.findUnique({ where: { id: lookId }, select: { id: true, personId: true, savedAt: true } });
  if (!row) throw new LookError("That look isn’t here anymore.", 404);
  await assertCanBuild(viewer, row.personId);
  return row;
}

function cleanStore(p: StorePieceInput) {
  const title = (p.title ?? "").trim().slice(0, 160);
  if (!title) throw new LookError("The piece needs a name.");
  const url = p.url?.trim() || null;
  if (url && !/^https?:\/\//i.test(url)) throw new LookError("That link doesn’t look right.");
  if (p.imageKey && !parseKey(p.imageKey)) throw new LookError("That picture isn’t one of ours.");
  const imageUrl = p.imageUrl?.trim() || null;
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) throw new LookError("That picture link doesn’t look right.");
  return { title, url: url?.slice(0, 1000) ?? null, storeName: p.storeName?.trim().slice(0, 80) || null, priceText: p.priceText?.trim().slice(0, 40) || null, imageUrl: imageUrl?.slice(0, 1000) ?? null, imageKey: p.imageKey ?? null, category: p.category?.trim().slice(0, 40) || null };
}

const full = () => new LookError(`A look holds up to ${MAX_LOOK_PIECES} pieces. Take one out first.`);

/** Add pieces to a look: a closet piece (the person's own, or one in the Family closet) or a store find. The same piece twice is kept once. */
export async function addPieces(viewer: Viewer, lookId: string, inputs: LookPieceInput[]): Promise<{ count: number; added: number }> {
  const look = await lookFor(viewer, lookId);
  const have = await db.lookPiece.findMany({ where: { lookId }, select: { itemId: true, url: true, imageKey: true, sortOrder: true } });
  let count = have.length, added = 0, order = Math.max(-1, ...have.map((p) => p.sortOrder));
  for (const input of inputs) {
    if ("itemId" in input) {
      if (have.some((p) => p.itemId === input.itemId)) continue;
      const item = await db.item.findFirst({ where: { id: input.itemId, retiredAt: null, OR: [{ ownerId: look.personId }, { closets: { some: { closet: { kind: "family" } } } }] }, select: { id: true } });
      if (!item) throw new LookError("That piece isn’t in the closet.");
      if (count >= MAX_LOOK_PIECES) throw full();
      await db.lookPiece.create({ data: { lookId, itemId: item.id, sortOrder: ++order } });
      have.push({ itemId: item.id, url: null, imageKey: null, sortOrder: order });
    } else {
      const s = cleanStore(input);
      if ((s.url && have.some((p) => p.url === s.url)) || (s.imageKey && have.some((p) => p.imageKey === s.imageKey))) continue;
      if (!s.url && !s.imageUrl && !s.imageKey) throw new LookError("The piece needs a link or a picture.");
      if (count >= MAX_LOOK_PIECES) throw full();
      await db.lookPiece.create({ data: { lookId, sortOrder: ++order, ...s } });
      have.push({ itemId: null, url: s.url, imageKey: s.imageKey, sortOrder: order });
    }
    count++; added++;
  }
  if (added) await db.look.update({ where: { id: lookId }, data: { updatedAt: new Date() } });
  return { count, added };
}

/** "Add to a look" from any screen: onto the person's open look, started if there is none. */
export async function addToLook(viewer: Viewer, personId: string, input: LookPieceInput): Promise<{ lookId: string; count: number; added: boolean }> {
  const lookId = await openOrStartLook(viewer, personId);
  const r = await addPieces(viewer, lookId, [input]);
  return { lookId, count: r.count, added: r.added > 0 };
}

export async function removePiece(viewer: Viewer, lookId: string, pieceId: string): Promise<void> {
  await lookFor(viewer, lookId);
  await db.lookPiece.deleteMany({ where: { id: pieceId, lookId } });
}

/** Name the look (the first time saves it under Fits → Looks; later it renames). */
export async function saveLook(viewer: Viewer, lookId: string, name: string): Promise<void> {
  const look = await lookFor(viewer, lookId);
  const n = name.trim().slice(0, 60);
  if (!n) throw new LookError("Give the look a name.");
  if (!(await db.lookPiece.count({ where: { lookId } }))) throw new LookError("Add a piece first.");
  await db.look.update({ where: { id: lookId }, data: { name: n, savedAt: look.savedAt ?? new Date() } });
}

export async function deleteLook(viewer: Viewer, lookId: string): Promise<void> {
  await lookFor(viewer, lookId);
  await db.look.delete({ where: { id: lookId } });
}

export async function getLook(viewer: Viewer, lookId: string): Promise<LookView | null> {
  const row = await db.look.findUnique({ where: { id: lookId }, include: { person: { select: { name: true } }, ...pieceInclude } });
  if (!row || !(await canShopFor(viewer, row.personId))) return null;
  return toView(row, true);
}

/** The person's saved looks, newest first (Fits → Looks). */
export async function listLooks(viewer: Viewer, personId: string): Promise<LookSummary[]> {
  if (!(await canShopFor(viewer, personId))) return [];
  const rows = await db.look.findMany({ where: { personId, savedAt: { not: null } }, orderBy: { savedAt: "desc" }, select: { id: true, name: true, savedAt: true, pieces: { select: { itemId: true } } } });
  return rows.map((r) => ({ id: r.id, name: r.name ?? "Look", pieces: r.pieces.length, toBuy: r.pieces.filter((p) => !p.itemId).length, savedAt: r.savedAt! }));
}

/**
 * What the mirror dresses for a look: the closet pieces' ids, and each store find as a garment picture, fetched once
 * into the bucket (looks/<personId>/…) so a second dressing reads it from there.
 */
export async function lookGarments(lookId: string): Promise<{ itemIds: string[]; extras: ExtraGarment[]; features: string[] }> {
  const row = await db.look.findUnique({ where: { id: lookId }, include: pieceInclude });
  if (!row) throw new LookError("That look isn’t here anymore.", 404);
  const itemIds = row.pieces.flatMap((p) => (p.item && !p.item.retiredAt ? [p.item.id] : []));
  const extras: ExtraGarment[] = [];
  const features = new Set<string>();
  for (const p of row.pieces) {
    if (p.item) continue;
    let key = p.imageKey;
    if (!key && p.imageUrl) {
      const img = await fetchImage(p.imageUrl);
      if (!img) continue;
      key = newKey("looks", row.personId, "image/jpeg");
      await putObject(key, await sharp(img.data).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer(), "image/jpeg");
      await db.lookPiece.update({ where: { id: p.id }, data: { imageKey: key } });
    }
    if (!key) continue;
    let buf: Buffer;
    try { buf = (await getObject(key)).body; } catch { continue; }
    extras.push({ id: `look-piece:${p.id}`, name: p.title ?? "the new piece", category: p.category, buf });
    for (const f of featuresOf({ category: p.category })) features.add(f);
  }
  return { itemIds, extras, features: [...features] };
}

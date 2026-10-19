import sharp from "sharp";
import { db } from "@/lib/db";
import { getObject, newKey, putObject } from "@/lib/storage";
import { googleTryOn, isGoogleTryOnConfigured, TryOnModelError } from "@/lib/tryon/google";
import type { Viewer } from "@/lib/people/visibility";

/**
 * Virtual try-on: a picture of the person wearing a look. Adults only, opt-in per person (Settings),
 * never minors. The person's most recent body photo plus up to three garment cutouts go to the
 * provider, one garment at a time (each result is the next "person" image). Results are the owner's
 * alone (`tryon/<personId>/…`) and cached per person + pieces + body photo, so a repeat costs nothing.
 */

export class TryOnError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "TryOnError";
  }
}

export type TryOnState = "ready" | "off" | "minor" | "no_photo" | "unconfigured" | "not_you";
export type BodyViewSide = "front" | "back";
export type TryOnView = { id: string; key: string; itemIds: string[]; createdAt: string; cached: boolean; /** Which body photo was dressed. */ view?: BodyViewSide; /** On the shared mannequin, not the person (src/lib/tryon/mannequin.ts). */ mannequin?: boolean };

export const MAX_GARMENTS = 3;
/** Garment order that reads best on a body: outer layer last. */
const ORDER = ["Tops", "Dresses", "Bottoms", "Shoes", "Outerwear"];

export function isTryOnConfigured(): boolean {
  return process.env.MOCK_TRYON === "true" || isGoogleTryOnConfigured();
}

/** Why TRY IT ON is or is not available for this viewer on this person. */
export async function tryOnState(viewer: Viewer, personId: string): Promise<TryOnState> {
  if (viewer.id !== personId) return "not_you";
  const p = await db.person.findUniqueOrThrow({ where: { id: personId }, select: { role: true, tryOnEnabled: true } });
  if (p.role === "minor") return "minor";
  if (!isTryOnConfigured()) return "unconfigured";
  if (!p.tryOnEnabled) return "off";
  if (!(await db.bodyPhoto.findFirst({ where: { personId } }))) return "no_photo";
  return "ready";
}

export async function setTryOnEnabled(viewer: Viewer, personId: string, enabled: boolean): Promise<void> {
  if (viewer.id !== personId) throw new TryOnError("Only you can turn this on for yourself.", 403);
  const p = await db.person.findUniqueOrThrow({ where: { id: personId }, select: { role: true } });
  if (p.role === "minor") throw new TryOnError("Try-on is for adults only.", 403);
  await db.person.update({ where: { id: personId }, data: { tryOnEnabled: enabled } });
}

async function assertReady(viewer: Viewer, personId: string) {
  const state = await tryOnState(viewer, personId);
  const why: Record<Exclude<TryOnState, "ready">, string> = {
    not_you: "You can only try looks on yourself.", minor: "Try-on is for adults only.", unconfigured: "Try-on isn’t set up on the site yet.",
    off: "Turn on try-on in Settings first.", no_photo: "Add a full-body photo on your Body page first.",
  };
  if (state !== "ready") throw new TryOnError(why[state], state === "not_you" || state === "minor" ? 403 : 400);
}

/** Dev/test stand-in: the body photo with each garment pasted on, so the UI and privacy can be tested without Google. */
export async function mockTryOn(person: Buffer, garments: Buffer[]): Promise<Buffer> {
  const base = sharp(person).rotate().resize(600, 800, { fit: "cover" });
  const meta = { w: 600, h: 800 };
  const composites = await Promise.all(garments.map(async (g, i) => ({ input: await sharp(g).flatten({ background: "#ffffff" }).resize(Math.round(meta.w * 0.4), Math.round(meta.h * 0.3), { fit: "inside" }).png().toBuffer(), left: Math.round(meta.w * 0.3), top: Math.round(meta.h * (0.15 + i * 0.28)) })));
  return base.composite(composites).jpeg({ quality: 85 }).toBuffer();
}

/** Garment image for an item: the cutout when there is one, else the main photo. */
export async function garmentImages(itemIds: string[], back = false): Promise<{ id: string; buf: Buffer }[]> {
  const items = await db.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, category: { select: { name: true } }, photos: { select: { kind: true, bucketKey: true, isPrimary: true } } } });
  const sorted = items.sort((a, b) => ORDER.indexOf(a.category?.name ?? "") - ORDER.indexOf(b.category?.name ?? ""));
  const out: { id: string; buf: Buffer }[] = [];
  for (const it of sorted) {
    if (it.category?.name && !ORDER.includes(it.category.name)) continue; // accessories, bags, hats: the model can't place them
    // From behind, a piece's own back photo is the better garment picture when it has one.
    const key = (back ? it.photos.find((p) => p.kind === "back")?.bucketKey : undefined) ?? it.photos.find((p) => p.kind === "cutout")?.bucketKey ?? it.photos.find((p) => p.isPrimary)?.bucketKey ?? it.photos[0]?.bucketKey;
    if (!key) continue;
    try { out.push({ id: it.id, buf: (await getObject(key)).body }); } catch { /* missing file: skip the piece */ }
    if (out.length === MAX_GARMENTS) break;
  }
  return out;
}

/** The look on the person. `source` is "today" or "shop" for the record. */
export async function tryOnLook(viewer: Viewer, personId: string, itemIds: string[], source: string, extraGarment?: Buffer, view: BodyViewSide = "front"): Promise<TryOnView> {
  await assertReady(viewer, personId);
  // Front: the front photo, else the newest photo of any view. Back: only a back photo will do.
  const photo = view === "back"
    ? await db.bodyPhoto.findFirst({ where: { personId, view: "back" }, orderBy: { takenAt: "desc" } })
    : (await db.bodyPhoto.findFirst({ where: { personId, view: "front" }, orderBy: { takenAt: "desc" } })) ?? (await db.bodyPhoto.findFirst({ where: { personId }, orderBy: { takenAt: "desc" } }));
  if (!photo) throw new TryOnError(view === "back" ? "Add a back photo on your Body page to see the look from behind." : "Add a full-body photo on your Body page first.");
  const ids = [...new Set(itemIds)];
  const cacheIds = extraGarment ? [...ids, `extra:${source}`] : ids;
  const hit = await db.tryOn.findFirst({ where: { personId, bodyPhotoKey: photo.bucketKey, itemIds: { equals: [...cacheIds].sort() } }, orderBy: { createdAt: "desc" } });
  if (hit) return { id: hit.id, key: hit.bucketKey, itemIds: hit.itemIds, createdAt: hit.createdAt.toISOString(), cached: true, view };
  const garments = [...(extraGarment ? [{ id: "extra", buf: extraGarment }] : []), ...(await garmentImages(ids, view === "back"))].slice(0, MAX_GARMENTS);
  if (!garments.length) throw new TryOnError("None of these pieces has a photo the try-on can use.");
  let person: Buffer = await sharp((await getObject(photo.bucketKey)).body).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  if (process.env.MOCK_TRYON === "true") {
    person = await mockTryOn(person, garments.map((g) => g.buf));
  } else {
    for (const g of garments) {
      const garment = await sharp(g.buf).flatten({ background: "#ffffff" }).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      let out: { data: Buffer };
      try { out = await googleTryOn(person, garment); } catch (e) {
        if (e instanceof TryOnModelError) throw new TryOnError(e.message, 502);
        throw e;
      }
      person = await sharp(out.data).jpeg({ quality: 90 }).toBuffer();
    }
  }
  const key = newKey("tryon", personId, "image/jpeg");
  await putObject(key, person, "image/jpeg");
  const row = await db.tryOn.create({ data: { personId, bucketKey: key, itemIds: [...cacheIds].sort(), bodyPhotoKey: photo.bucketKey, source } });
  return { id: row.id, key, itemIds: row.itemIds, createdAt: row.createdAt.toISOString(), cached: false, view };
}

/** Does this person have a back photo (so the mirror can offer the view from behind)? */
export async function hasBackPhoto(personId: string): Promise<boolean> {
  return Boolean(await db.bodyPhoto.findFirst({ where: { personId, view: "back" }, select: { id: true } }));
}

export async function listTryOns(personId: string, take = 12): Promise<TryOnView[]> {
  const rows = await db.tryOn.findMany({ where: { personId, source: { not: { startsWith: "mannequin:" } } }, orderBy: { createdAt: "desc" }, take });
  return rows.map((r) => ({ id: r.id, key: r.bucketKey, itemIds: r.itemIds, createdAt: r.createdAt.toISOString(), cached: true }));
}

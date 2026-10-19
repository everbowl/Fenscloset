import sharp from "sharp";
import { db } from "@/lib/db";
import { getObject, newKey, putObject } from "@/lib/storage";
import { googleTryOn, isGoogleTryOnConfigured, TryOnModelError } from "@/lib/tryon/google";
import { googleImage } from "@/lib/images/smooth";
import { checkRender, checkWholeGarment, isGarmentCheckAvailable } from "@/lib/tryon/garment-check";
import { loadPrefs, loadStylingLists, lookFeatures, resolveStyling, savePrefs, stylingPrompt, type Styling, type StylingChoice, type StylingLists } from "@/lib/tryon/styling";
import { MIRROR_CATEGORIES } from "@/lib/tryon/features";
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
/** The styling chips for the mirror: the pose row and each group that applies to the look, with what is chosen. */
export type StylingView = { summary: string; poseId: string | null; poses: { id: string; name: string }[]; groups: Styling["groups"] };
export type TryOnView = {
  id: string; key: string; itemIds: string[]; createdAt: string; cached: boolean;
  /** Which body photo was dressed. */ view?: BodyViewSide;
  /** On the shared mannequin, not the person (src/lib/tryon/mannequin.ts). */ mannequin?: boolean;
  /** How the look is styled (pose, tuck, buttons…) and what else could be picked. */ styling?: StylingView;
  /** The styling pass did not come back: this is the plain try-on. */ stylingFailed?: boolean;
  /** The render check was not satisfied even after a second dressing: what it saw wrong, shown under the picture. */ note?: string | null;
};

/** The styling for a look as the person last left it (or the defaults), remembering any new picks. */
export async function stylingFor(personId: string, itemIds: string[], pick: StylingChoice | undefined, extraFeatures: string[] = []): Promise<{ lists: StylingLists; styling: Styling }> {
  const [lists, remembered, features] = await Promise.all([loadStylingLists(), loadPrefs(personId), lookFeatures(itemIds)]);
  if (pick) await savePrefs(personId, lists, pick);
  return { lists, styling: resolveStyling(lists, remembered, pick, [...features, ...extraFeatures]) };
}

export function stylingView(lists: StylingLists, styling: Styling): StylingView {
  return { summary: styling.summary, poseId: styling.poseId, poses: lists.poses.map((p) => ({ id: p.id, name: p.name })), groups: styling.groups };
}

/** Dev/test stand-in for the styling pass: the same picture, a touch brighter, so a styled result is its own file. */
async function mockStyle(raw: Buffer): Promise<Buffer> {
  return sharp(raw).modulate({ brightness: 1.05 }).jpeg({ quality: 85 }).toBuffer();
}

/** The render check, never fatal: when it cannot run, the picture passes. */
async function renderVerdict(picture: Buffer, garments: { name: string; buf: Buffer }[]): Promise<{ ok: boolean; problem: string | null }> {
  try { return await checkRender(picture, garments); } catch (e) { console.error("tryon: render check failed", e); return { ok: true, problem: null }; }
}

/** The image model's brief when the try-on model got a piece wrong: the person, dressed in exactly these pieces, nothing else touched. */
function dressPrompt(names: string[]): string {
  return `The first image is a photo of a person. The images after it are garments: ${names.join(", ")}. Dress the person in exactly these garments as they truly are: the same cut, color, print, lettering and fabric, each garment one whole piece with no holes and no missing panels, at its full length (a top hangs to the hip or below, over the waistband, unless its photo shows a cropped cut). Keep the person's face, hair, skin, body shape and pose, and the background, lighting and framing, exactly as they are. Add nothing else. Return only the photo.`;
}

/** An item's photos changed (new, removed, turned, chosen for the mirror): every picture made with it is forgotten, so the next look is dressed afresh. */
export async function forgetTryOns(itemId: string): Promise<number> {
  return (await db.tryOn.deleteMany({ where: { itemIds: { has: itemId } } })).count;
}

export const MAX_GARMENTS = 3;
/** Garment order that reads best on a body: outer layer last (src/lib/tryon/features.ts, shared with the closet's pick mode). */
const ORDER: readonly string[] = MIRROR_CATEGORIES;
/** Progress reports while a look is dressed ("Dressing you · Oxford", "Checking the picture…"), shown in the mirror while it runs. */
export type DressingHooks = { step?: (step: string) => void };

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

/**
 * Garment image for an item, in this order: the photo the person chose for the mirror, else (from behind) its
 * back photo, else the store's product photo, the person's own photo of the piece, the cutout, any other photo,
 * a thumbnail last. The cutout comes after the real photo on purpose: Tidy replaces it with an AI re-draw, and
 * a re-draw (or a background-removal hole) is how a tee came out cropped with a hole in the back (Jeff, 19 Oct
 * 2026). A photo that does not show the whole piece (checked once, kept on the photo) is passed over.
 */
export async function garmentImages(itemIds: string[], back = false): Promise<{ id: string; name: string; buf: Buffer }[]> {
  const items = await db.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, category: { select: { name: true } }, photos: { select: { id: true, kind: true, bucketKey: true, isPrimary: true, forMirror: true, wholeGarment: true }, orderBy: { createdAt: "asc" } } } });
  const sorted = items.sort((a, b) => ORDER.indexOf(a.category?.name ?? "") - ORDER.indexOf(b.category?.name ?? ""));
  const out: { id: string; name: string; buf: Buffer }[] = [];
  for (const it of sorted) {
    if (it.category?.name && !ORDER.includes(it.category.name)) continue; // accessories, bags, hats: the model can't place them
    const usable = it.photos.filter((p) => p.kind !== "label" && p.kind !== "worn");
    const chosen = usable.find((p) => p.forMirror);
    const ranked = [
      ...(back ? usable.filter((p) => p.kind === "back") : []),
      ...usable.filter((p) => p.kind === "retail"),
      ...usable.filter((p) => p.kind === "alone"),
      ...usable.filter((p) => p.kind === "cutout"),
      ...usable.filter((p) => p.isPrimary),
      ...usable.filter((p) => p.kind !== "thumb"),
      ...usable, // a thumbnail is the last resort (a piece that only has one)
    ].filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i && p.id !== chosen?.id);
    const candidates = chosen ? [chosen, ...ranked] : ranked;
    let picked: { buf: Buffer; kind: string } | null = null;
    const skipped: string[] = [];
    let fallback: { buf: Buffer; kind: string } | null = null;
    for (const p of candidates) {
      let buf: Buffer;
      try { buf = (await getObject(p.bucketKey)).body; } catch { continue; } // missing file: next photo
      if (p.forMirror) { picked = { buf, kind: p.kind }; break; } // the person's choice is not second-guessed
      let whole = p.wholeGarment;
      if (whole === null && isGarmentCheckAvailable()) {
        try {
          const check = await checkWholeGarment(buf);
          whole = check.whole;
          await db.itemPhoto.update({ where: { id: p.id }, data: { wholeGarment: whole } });
          if (!whole) console.log(`tryon: ${it.name ?? it.id} ${p.kind} photo not whole (${check.problem})`);
        } catch (e) { console.error("tryon: whole-garment check failed", e); whole = true; }
      }
      if (whole === false) { skipped.push(p.kind); fallback ??= { buf, kind: p.kind }; continue; }
      picked = { buf, kind: p.kind }; break;
    }
    picked ??= fallback; // nothing passed: the best there is, rather than no try-on
    if (!picked) continue;
    console.log(`tryon: ${it.name ?? it.id} → ${picked.kind} photo${skipped.length ? ` (passed over: ${skipped.join(", ")})` : ""}`);
    out.push({ id: it.id, name: it.name ?? (it.category?.name ?? "piece"), buf: picked.buf });
    if (out.length === MAX_GARMENTS) break;
  }
  return out;
}

/**
 * The look on the person. `source` is "today" or "shop" for the record. Two pictures are kept per look:
 * the raw try-on (styling null) and the styled one (pose, tuck, buttons… applied by a second, Gemini
 * image pass), so changing a chip never re-dresses the body. `pick` is this call's change, remembered
 * for next time. `extraFeatures` describes a garment that is not an item (a shop candidate).
 */
export async function tryOnLook(viewer: Viewer, personId: string, itemIds: string[], source: string, extraGarment?: Buffer, view: BodyViewSide = "front", pick?: StylingChoice, extraFeatures: string[] = [], fresh = false, hooks: DressingHooks = {}): Promise<TryOnView> {
  const step = (s: string) => hooks.step?.(s);
  await assertReady(viewer, personId);
  // Front: the front photo, else the newest photo of any view. Back: only a back photo will do.
  const photo = view === "back"
    ? await db.bodyPhoto.findFirst({ where: { personId, view: "back" }, orderBy: { takenAt: "desc" } })
    : (await db.bodyPhoto.findFirst({ where: { personId, view: "front" }, orderBy: { takenAt: "desc" } })) ?? (await db.bodyPhoto.findFirst({ where: { personId }, orderBy: { takenAt: "desc" } }));
  if (!photo) throw new TryOnError(view === "back" ? "Add a back photo on your Body page to see the look from behind." : "Add a full-body photo on your Body page first.");
  const ids = [...new Set(itemIds)];
  const cacheIds = [...(extraGarment ? [...ids, `extra:${source}`] : ids)].sort();
  const { lists, styling } = await stylingFor(personId, ids, pick, extraFeatures);
  const where = { personId, bodyPhotoKey: photo.bucketKey, itemIds: { equals: cacheIds } };
  if (fresh) await db.tryOn.deleteMany({ where }); // "Dress again": the look is dressed from scratch, raw and styled
  const pack = (row: { id: string; bucketKey: string; itemIds: string[]; createdAt: Date; note?: string | null }, cached: boolean, stylingFailed = false): TryOnView =>
    ({ id: row.id, key: row.bucketKey, itemIds: row.itemIds, createdAt: row.createdAt.toISOString(), cached, view, styling: stylingView(lists, styling), note: row.note ?? null, ...(stylingFailed ? { stylingFailed } : {}) });

  // The styled picture for these exact choices, if it was made before.
  if (styling.instructions.length) {
    const styled = await db.tryOn.findFirst({ where: { ...where, styling: styling.key }, orderBy: { createdAt: "desc" } });
    if (styled) return pack(styled, true);
  }
  // The raw try-on, made once per look + body photo.
  let raw = await db.tryOn.findFirst({ where: { ...where, styling: null }, orderBy: { createdAt: "desc" } });
  let rawCached = Boolean(raw);
  let person: Buffer;
  if (raw) person = (await getObject(raw.bucketKey)).body;
  else {
    const garments = [...(extraGarment ? [{ id: "extra", name: "the new piece", buf: extraGarment }] : []), ...(await garmentImages(ids, view === "back"))].slice(0, MAX_GARMENTS);
    if (!garments.length) throw new TryOnError("None of these pieces has a photo the try-on can use.");
    const body = await sharp((await getObject(photo.bucketKey)).body).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    person = body;
    step(`Dressing you · ${garments.map((g) => g.name).join(", ")}`);
    if (process.env.MOCK_TRYON === "true") {
      person = await mockTryOn(person, garments.map((g) => g.buf));
    } else {
      for (const g of garments) {
        step(`Dressing you · ${g.name}`);
        const garment = await sharp(g.buf).flatten({ background: "#ffffff" }).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
        let out: { data: Buffer };
        try { out = await googleTryOn(person, garment); } catch (e) {
          if (e instanceof TryOnModelError) throw new TryOnError(e.message, 502);
          throw e;
        }
        person = await sharp(out.data).jpeg({ quality: 90 }).toBuffer();
      }
    }
    // Is each piece worn as it really is (full length, no holes, no missing panels)? If not, the image model dresses the
    // person once more with the pieces named, and the first picture that passes is kept. Neither passing: the try-on's
    // picture stays, with what the check saw under it, rather than nothing at all.
    let note: string | null = null;
    step("Checking the picture…");
    const verdict = await renderVerdict(person, garments);
    if (!verdict.ok) {
      console.log(`tryon: render check: ${verdict.problem}; dressing again with the image model`);
      step("Dressing again…");
      try {
        const again = process.env.MOCK_TRYON === "true" ? await mockStyle(person) : await sharp(await googleImage([{ data: body, mimeType: "image/jpeg" }, ...(await Promise.all(garments.map(async (g) => ({ data: await sharp(g.buf).flatten({ background: "#ffffff" }).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(), mimeType: "image/jpeg" as const }))))], dressPrompt(garments.map((g) => g.name)), fetch, { relaxed: true })).jpeg({ quality: 90 }).toBuffer();
        step("Checking again…");
        const second = await renderVerdict(again, garments);
        if (second.ok) person = again;
        else { note = `The mirror isn’t sure about this one: ${second.problem ?? verdict.problem}`; console.log(`tryon: second render check: ${second.problem}`); }
      } catch (e) { console.error("tryon: second dressing failed", e); note = `The mirror isn’t sure about this one: ${verdict.problem}`; }
    }
    const key = newKey("tryon", personId, "image/jpeg");
    await putObject(key, person, "image/jpeg");
    raw = await db.tryOn.create({ data: { personId, bucketKey: key, itemIds: cacheIds, bodyPhotoKey: photo.bucketKey, source, note } });
    rawCached = false;
  }
  if (!styling.instructions.length) return pack(raw, rawCached);
  // The styling pass: pose and wear choices on the dressed picture. If it fails, the plain try-on is shown.
  let styledBuf: Buffer;
  step(`Styling · ${styling.summary}`);
  try {
    // An adult's own body picture (assertReady keeps minors out): Google's filters are loosened for this pass only.
    styledBuf = process.env.MOCK_TRYON === "true" ? await mockStyle(person) : await sharp(await googleImage([{ data: person, mimeType: "image/jpeg" }], stylingPrompt(styling.instructions), fetch, { relaxed: true })).jpeg({ quality: 90 }).toBuffer();
  } catch (e) {
    console.error("styling pass failed", e);
    return pack(raw, rawCached, true);
  }
  // The styling pass is an edit by the image model and can re-draw a piece (a crew neck came back as a polo): the styled
  // picture gets the same check as the dressed one, and when a piece changed, the verified picture is shown instead.
  step("Checking the styled picture…");
  const styledGarments = await garmentImages(ids, view === "back");
  const styledVerdict = await renderVerdict(styledBuf, styledGarments);
  if (!styledVerdict.ok) { console.log(`tryon: styled picture failed the check (${styledVerdict.problem}); showing the plain try-on`); return pack(raw, rawCached, true); }
  const key = newKey("tryon", personId, "image/jpeg");
  await putObject(key, styledBuf, "image/jpeg");
  const row = await db.tryOn.create({ data: { personId, bucketKey: key, itemIds: cacheIds, bodyPhotoKey: photo.bucketKey, source, styling: styling.key, note: raw.note } });
  return pack(row, false);
}

/** Does this person have a back photo (so the mirror can offer the view from behind)? */
export async function hasBackPhoto(personId: string): Promise<boolean> {
  return Boolean(await db.bodyPhoto.findFirst({ where: { personId, view: "back" }, select: { id: true } }));
}

/** Recent pictures of the person, newest first. A raw try-on is listed only until a styled picture of the same look exists. */
export async function listTryOns(personId: string, take = 12): Promise<TryOnView[]> {
  const rows = await db.tryOn.findMany({ where: { personId, source: { not: { startsWith: "mannequin:" } } }, orderBy: { createdAt: "desc" }, take: take * 2 });
  const styledLooks = new Set(rows.filter((r) => r.styling).map((r) => `${r.bodyPhotoKey}|${r.itemIds.join()}`));
  return rows.filter((r) => r.styling || !styledLooks.has(`${r.bodyPhotoKey}|${r.itemIds.join()}`)).slice(0, take).map((r) => ({ id: r.id, key: r.bucketKey, itemIds: r.itemIds, createdAt: r.createdAt.toISOString(), cached: true }));
}

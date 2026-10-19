import sharp from "sharp";
import { db } from "@/lib/db";
import { getObject, newKey, objectExists, putObject } from "@/lib/storage";
import { googleImage, isSmoothConfigured } from "@/lib/images/smooth";
import { garmentImages, MAX_GARMENTS, mockTryOn, stylingFor, stylingView, TryOnError, type TryOnView } from "@/lib/tryon";
import { stylingSentence, type StylingChoice } from "@/lib/tryon/features";
import { MANNEQUIN_BASE_KEY } from "@/lib/tryon/mannequin-key";
import type { Viewer } from "@/lib/people/visibility";

/**
 * SEE IT ON for anyone without a try-on of their own (Jeff, 18 Oct 2026, T A): the look dressed on a
 * plain mannequin. No body photo and no measurements are involved, so it is allowed for minors and
 * for a parent dressing a minor. The mannequin itself is one shared picture, made once (Gemini image)
 * and kept at MANNEQUIN_BASE_KEY; each look is one Gemini image call with the mannequin plus up to
 * three garment cutouts. Results are TryOn rows with source "mannequin:<where>" under
 * `mannequin/<personId>/…`, cached per person + pieces. MOCK_TRYON pastes the garments on instead.
 */

const BASE_PROMPT = "A photograph of a plain, featureless, light-gray dress-form mannequin with a simple head, shoulders, arms and legs, standing straight, full body from head to feet, facing the camera, centered, on a seamless white studio background with soft even light. No clothes, no face, no text, no props.";
/** The dressing brief; the person's pose and wear choices (src/lib/tryon/features.ts) ride along in one call. */
function dressPrompt(instructions: string[]): string {
  return `The first image is a mannequin. Dress it in exactly the garments shown in the other images, each worn the way it is meant to be worn, keeping every garment's true shape, color, print, lettering and length.${stylingSentence(instructions)} Keep the mannequin${instructions.length ? "" : ", its pose"}, the framing and the white background exactly as they are. Add nothing else: no other clothes, accessories, text or props. Return only the finished photo.`;
}

export function isMannequinConfigured(): boolean {
  return process.env.MOCK_TRYON === "true" || isSmoothConfigured();
}

/** Dev/test stand-in for the shared mannequin: a drawn figure. */
async function drawnMannequin(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024"><rect width="768" height="1024" fill="#ffffff"/>
    <g fill="#c9c6c0"><circle cx="384" cy="120" r="54"/><rect x="364" y="170" width="40" height="40"/><path d="M254 230 Q384 190 514 230 L536 520 Q384 560 232 520 Z"/><rect x="214" y="236" width="42" height="300" rx="21"/><rect x="512" y="236" width="42" height="300" rx="21"/><rect x="286" y="540" width="84" height="400" rx="30"/><rect x="398" y="540" width="84" height="400" rx="30"/></g></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

/** The shared mannequin picture: made on first use, then reused by everyone. */
export async function mannequinBase(fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  if (await objectExists(MANNEQUIN_BASE_KEY)) return (await getObject(MANNEQUIN_BASE_KEY)).body;
  const raw = process.env.MOCK_TRYON === "true" ? await drawnMannequin() : await googleImage([], BASE_PROMPT, fetchImpl);
  const jpeg = await sharp(raw).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  await putObject(MANNEQUIN_BASE_KEY, jpeg, "image/jpeg");
  return jpeg;
}

async function assertCanDress(viewer: Viewer, personId: string) {
  if (viewer.id === personId) return;
  const link = await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: personId, parentId: viewer.id } } });
  if (!link) throw new TryOnError("Only the person (or their parent) can do that.", 403);
}

/** The look on the mannequin. `source` is "today" or "shop" for the record. `pick` is this call's styling change (pose, tuck…), remembered for the person. */
export async function mannequinLook(viewer: Viewer, personId: string, itemIds: string[], source: string, extraGarment?: Buffer, fetchImpl: typeof fetch = fetch, pick?: StylingChoice, extraFeatures: string[] = []): Promise<TryOnView> {
  await assertCanDress(viewer, personId);
  if (!isMannequinConfigured()) throw new TryOnError("The mannequin isn’t set up on the site yet.");
  const ids = [...new Set(itemIds)].sort();
  const cacheIds = extraGarment ? [...ids, `extra:${source}`].sort() : ids;
  const { lists, styling } = await stylingFor(personId, ids, pick, extraFeatures);
  const view = stylingView(lists, styling);
  const hit = await db.tryOn.findFirst({ where: { personId, bodyPhotoKey: MANNEQUIN_BASE_KEY, itemIds: { equals: cacheIds }, styling: styling.key }, orderBy: { createdAt: "desc" } });
  if (hit) return { id: hit.id, key: hit.bucketKey, itemIds: hit.itemIds, createdAt: hit.createdAt.toISOString(), cached: true, mannequin: true, styling: view };
  const garments = [...(extraGarment ? [{ id: "extra", buf: extraGarment }] : []), ...(await garmentImages(ids))].slice(0, MAX_GARMENTS);
  if (!garments.length) throw new TryOnError("None of these pieces has a photo the mannequin can wear.");
  const base = await mannequinBase(fetchImpl);
  let picture: Buffer;
  if (process.env.MOCK_TRYON === "true") picture = await mockTryOn(base, garments.map((g) => g.buf));
  else {
    const pngs = await Promise.all(garments.map(async (g) => ({ data: await sharp(g.buf).flatten({ background: "#ffffff" }).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(), mimeType: "image/jpeg" as const })));
    picture = await sharp(await googleImage([{ data: base, mimeType: "image/jpeg" }, ...pngs], dressPrompt(styling.instructions), fetchImpl)).jpeg({ quality: 90 }).toBuffer();
  }
  const key = newKey("mannequin", personId, "image/jpeg");
  await putObject(key, picture, "image/jpeg");
  const row = await db.tryOn.create({ data: { personId, bucketKey: key, itemIds: cacheIds, bodyPhotoKey: MANNEQUIN_BASE_KEY, source: `mannequin:${source}`, styling: styling.key } });
  return { id: row.id, key, itemIds: row.itemIds, createdAt: row.createdAt.toISOString(), cached: false, mannequin: true, styling: view };
}

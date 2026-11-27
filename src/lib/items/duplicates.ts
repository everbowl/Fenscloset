import { db } from "@/lib/db";
import { hamming } from "@/lib/images/phash";
import { getObject } from "@/lib/storage";
import { toAiImage } from "@/lib/images/thumb";
import { sameGarment } from "@/lib/ai/same-garment";

export type DuplicateHint = { itemId: string; name: string | null; thumbKey: string | null; score: number; reason: "photo" | "tags" };

const PHOTO_MAX_DISTANCE = 10;

/** What the hash-and-tags check needs about a piece the person owns: no photos, no relation arrays (review B C4). */
export type DuplicateCandidate = { id: string; name: string | null; phash: string | null; categoryId: string | null; brandId: string | null; firstColorId: string | null };

/** The owner's pieces, newest first, slim. The import pipeline starts this load while remove.bg and Claude are still working. */
export async function loadDuplicateCandidates(personId: string, excludeItemId?: string): Promise<DuplicateCandidate[]> {
  const items = await db.item.findMany({
    where: { ownerId: personId, ...(excludeItemId ? { NOT: { id: excludeItemId } } : {}) },
    select: { id: true, name: true, phash: true, categoryId: true, brandId: true, colors: { select: { id: true }, take: 1 } },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  return items.map((it) => ({ id: it.id, name: it.name, phash: it.phash, categoryId: it.categoryId, brandId: it.brandId, firstColorId: it.colors[0]?.id ?? null }));
}

/**
 * "Looks like one you own": a near-identical photo hash, or the same category + first color + brand.
 * Two different black tees are NOT a match unless the hash says so (brand is required for the tag rule).
 * A photo match never crosses item types: when both the new photo and the piece have a category, they
 * must agree (gray sweats on white and a tee on white hash alike, but are not the same piece).
 * `candidates` may be passed in when the caller already loaded them; the hit's thumbnail is fetched afterwards, once.
 */
export async function findLikelyDuplicate(personId: string, probe: { phash: string | null; categoryId: string | null; colorIds: string[]; brandId: string | null }, excludeItemId?: string, candidates?: DuplicateCandidate[]): Promise<DuplicateHint | null> {
  const items = candidates ?? await loadDuplicateCandidates(personId, excludeItemId);
  let best: { it: DuplicateCandidate; score: number; reason: "photo" | "tags" } | null = null;
  if (probe.phash) {
    for (const it of items) {
      if (!it.phash) continue;
      if (probe.categoryId && it.categoryId && it.categoryId !== probe.categoryId) continue;
      const d = hamming(probe.phash, it.phash);
      if (d <= PHOTO_MAX_DISTANCE && (!best || d < best.score)) best = { it, score: d, reason: "photo" };
    }
  }
  if (!best && probe.categoryId && probe.brandId && probe.colorIds[0]) {
    const hit = items.find((it) => it.categoryId === probe.categoryId && it.brandId === probe.brandId && it.firstColorId === probe.colorIds[0]);
    if (hit) best = { it: hit, score: 64, reason: "tags" };
  }
  if (!best) return null;
  const thumb = await db.itemPhoto.findFirst({ where: { itemId: best.it.id, kind: "thumb" }, select: { bucketKey: true } });
  return { itemId: best.it.id, name: best.it.name, thumbKey: thumb?.bucketKey ?? null, score: best.score, reason: best.reason };
}

/**
 * The hint the card may show: a photo match is only kept when Claude confirms the two pictures show
 * the same piece (the hash alone mistakes one black tee for another). Tag matches (category + brand +
 * color) need no picture check. `image` is the new photo (cutout or original).
 */
export async function confirmedDuplicate(personId: string, probe: Parameters<typeof findLikelyDuplicate>[1], image: Buffer, candidates?: DuplicateCandidate[]): Promise<DuplicateHint | null> {
  const hint = await findLikelyDuplicate(personId, probe, undefined, candidates);
  if (!hint || hint.reason !== "photo") return hint;
  const photo = await db.itemPhoto.findFirst({ where: { itemId: hint.itemId, kind: { in: ["cutout", "alone"] } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { bucketKey: true } });
  if (!photo) return null;
  try {
    const [a, b] = await Promise.all([toAiImage(image), toAiImage((await getObject(photo.bucketKey)).body)]);
    const r = await sameGarment(a, b);
    return r.same ? hint : null;
  } catch (e) {
    console.debug("duplicate check skipped", (e as Error).message); // a hint only: a failure here never blocks the piece (review B E15)
    return null;
  }
}

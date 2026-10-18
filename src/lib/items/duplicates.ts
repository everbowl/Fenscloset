import { db } from "@/lib/db";
import { hamming } from "@/lib/images/phash";

export type DuplicateHint = { itemId: string; name: string | null; thumbKey: string | null; score: number; reason: "photo" | "tags" };

const PHOTO_MAX_DISTANCE = 10;

/**
 * "Looks like one you own": a near-identical photo hash, or the same category + first color + brand.
 * Two different black tees are NOT a match unless the hash says so (brand is required for the tag rule).
 */
export async function findLikelyDuplicate(personId: string, probe: { phash: string | null; categoryId: string | null; colorIds: string[]; brandId: string | null }, excludeItemId?: string): Promise<DuplicateHint | null> {
  const items = await db.item.findMany({
    where: { ownerId: personId, ...(excludeItemId ? { NOT: { id: excludeItemId } } : {}) },
    select: { id: true, name: true, phash: true, categoryId: true, brandId: true, colors: { select: { id: true }, take: 1 }, photos: { where: { kind: "thumb" }, take: 1, select: { bucketKey: true } } },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  let best: DuplicateHint | null = null;
  if (probe.phash) {
    for (const it of items) {
      if (!it.phash) continue;
      const d = hamming(probe.phash, it.phash);
      if (d <= PHOTO_MAX_DISTANCE && (!best || d < best.score)) best = { itemId: it.id, name: it.name, thumbKey: it.photos[0]?.bucketKey ?? null, score: d, reason: "photo" };
    }
  }
  if (best) return best;
  if (probe.categoryId && probe.brandId && probe.colorIds[0]) {
    const hit = items.find((it) => it.categoryId === probe.categoryId && it.brandId === probe.brandId && it.colors[0]?.id === probe.colorIds[0]);
    if (hit) return { itemId: hit.id, name: hit.name, thumbKey: hit.photos[0]?.bucketKey ?? null, score: 64, reason: "tags" };
  }
  return null;
}

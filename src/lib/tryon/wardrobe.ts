import { db } from "@/lib/db";
import { MIRROR_CATEGORIES } from "@/lib/tryon/features";
import type { MirrorPiece, Wardrobe } from "@/lib/tryon/complete";

/** The Shop's go-with looks count as suggestions for this long. */
const SUGGEST_DAYS = 7;

/**
 * The pieces of someone's closet the mirror can place (tops, bottoms, dresses, shoes, outer layers), favorites first,
 * then most recently worn, then newest; and which pieces the Shop's "go with it" already put together, so the mirror
 * can offer those first when it asks to complete a look.
 */
export async function mirrorWardrobe(personId: string): Promise<Wardrobe> {
  const [items, goWith] = await Promise.all([
    db.item.findMany({
      where: { ownerId: personId, retiredAt: null, category: { name: { in: [...MIRROR_CATEGORIES] } } },
      orderBy: [{ isFavorite: "desc" }, { lastWornAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: { id: true, name: true, isFavorite: true, category: { select: { name: true } }, photos: { where: { kind: "thumb" }, take: 1, select: { bucketKey: true } } },
    }),
    db.goWith.findMany({ where: { forPersonId: personId, createdAt: { gt: new Date(Date.now() - SUGGEST_DAYS * 86400_000) } }, select: { itemId: true, closetLooks: true } }),
  ]);
  const pieces: MirrorPiece[] = items.map((it) => ({ id: it.id, name: it.name ?? "Untitled piece", thumbKey: it.photos[0]?.bucketKey ?? null, category: it.category?.name ?? null, isFavorite: it.isFavorite }));
  const ids = new Set(pieces.map((p) => p.id));
  const goesWith: Record<string, Set<string>> = {};
  for (const g of goWith) {
    for (const look of (g.closetLooks as { itemIds: string[] }[] | null) ?? []) {
      for (const a of look.itemIds) for (const b of look.itemIds) {
        if (a === b || !ids.has(a) || !ids.has(b)) continue;
        (goesWith[a] ??= new Set()).add(b);
      }
    }
  }
  return { pieces, goesWith: Object.fromEntries(Object.entries(goesWith).map(([k, v]) => [k, [...v]])) };
}

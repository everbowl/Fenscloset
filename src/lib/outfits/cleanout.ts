import { db } from "@/lib/db";
import { getRuleNumber } from "@/lib/rules";
import { canEditItem, type Viewer } from "@/lib/people/visibility";
import { OutfitError } from "@/lib/outfits/engine";

/** Pieces not worn for `notWornMonths` (never worn counts from the day they were added). KEEP snoozes 3 months; DONATE/SELL retire. */
export type CleanOutItem = { id: string; name: string; thumbKey: string | null; categoryName: string | null; lastWornAt: Date | null; createdAt: Date; wearCount: number };

export async function cleanOutCutoff(now = new Date()): Promise<{ months: number; cutoff: Date }> {
  const months = await getRuleNumber("notWornMonths", 6);
  const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - months);
  return { months, cutoff };
}

export async function listCleanOut(personId: string, now = new Date()): Promise<{ months: number; items: CleanOutItem[] }> {
  const { months, cutoff } = await cleanOutCutoff(now);
  const items = await db.item.findMany({
    where: {
      ownerId: personId, retiredAt: null,
      OR: [{ cleanOutSnoozedUntil: null }, { cleanOutSnoozedUntil: { lt: now } }],
      AND: [{ OR: [{ lastWornAt: { lt: cutoff } }, { lastWornAt: null, createdAt: { lt: cutoff } }] }],
    },
    orderBy: [{ lastWornAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    select: { id: true, name: true, lastWornAt: true, createdAt: true, wearCount: true, category: { select: { name: true } }, photos: { where: { kind: "thumb" }, take: 1, select: { bucketKey: true } } },
  });
  return { months, items: items.map((it) => ({ id: it.id, name: it.name ?? "Untitled piece", thumbKey: it.photos[0]?.bucketKey ?? null, categoryName: it.category?.name ?? null, lastWornAt: it.lastWornAt, createdAt: it.createdAt, wearCount: it.wearCount })) };
}

export async function countCleanOut(personId: string, now = new Date()): Promise<number> {
  return (await listCleanOut(personId, now)).items.length;
}

export async function cleanOutDecision(viewer: Viewer, itemId: string, decision: "keep" | "donate" | "sell", now = new Date()): Promise<void> {
  const item = await db.item.findUnique({ where: { id: itemId }, select: { ownerId: true } });
  if (!item) throw new OutfitError("That piece is gone.", 404);
  if (!canEditItem(viewer, item.ownerId)) throw new OutfitError("Only the owner or an admin can decide that.", 403);
  if (decision === "keep") {
    const until = new Date(now); until.setMonth(until.getMonth() + 3);
    await db.item.update({ where: { id: itemId }, data: { cleanOutSnoozedUntil: until } });
  } else {
    await db.item.update({ where: { id: itemId }, data: { retiredAt: now, retiredReason: decision, neverSuggest: true } });
  }
}

/** Bring a retired piece back (item detail). */
export async function unretire(viewer: Viewer, itemId: string): Promise<void> {
  const item = await db.item.findUnique({ where: { id: itemId }, select: { ownerId: true } });
  if (!item) throw new OutfitError("That piece is gone.", 404);
  if (!canEditItem(viewer, item.ownerId)) throw new OutfitError("Only the owner or an admin can do that.", 403);
  await db.item.update({ where: { id: itemId }, data: { retiredAt: null, retiredReason: null, neverSuggest: false, cleanOutSnoozedUntil: null } });
}

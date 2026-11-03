import { db } from "@/lib/db";
import { getRuleNumber } from "@/lib/rules";
import { canEditItem, type Viewer } from "@/lib/people/visibility";
import { OutfitError } from "@/lib/outfits/engine";
import { countsOf, laundrySummary } from "@/lib/items/copies";

/** Pieces not worn for `notWornMonths` (never worn counts from the day they were added). KEEP snoozes 3 months; DONATE/SELL retire. */
export type CleanOutItem = { id: string; name: string; thumbKey: string | null; categoryName: string | null; lastWornAt: Date | null; createdAt: Date; wearCount: number };

export async function cleanOutCutoff(now = new Date()): Promise<{ months: number; cutoff: Date }> {
  const months = await getRuleNumber("notWornMonths", 6);
  const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - months);
  return { months, cutoff };
}

/** A stack with more copies than its wears call for: "ten, worn five times in 90 days, two would do" (Jeff, 2 Nov 2026). */
export type StackAdvice = { id: string; name: string; thumbKey: string | null; categoryName: string | null; copies: number; wears90: number; keep: number; cycleDays: number };

/** How many copies a stack needs: the wears of the last 90 days spread over laundry cycles, at least one. */
export function copiesNeeded(wears90: number, cycleDays: number): number {
  const cycles = Math.max(1, 90 / Math.max(1, cycleDays));
  return Math.max(1, Math.ceil(wears90 / cycles));
}

export async function listStacks(personId: string, now = new Date()): Promise<StackAdvice[]> {
  const cycleDays = await getRuleNumber("laundryCycleDays", 7);
  const since = new Date(now); since.setDate(since.getDate() - 90);
  const stacks = await db.item.findMany({
    where: { ownerId: personId, retiredAt: null, copies: { gt: 1 }, OR: [{ cleanOutSnoozedUntil: null }, { cleanOutSnoozedUntil: { lt: now } }] },
    select: { id: true, name: true, copies: true, category: { select: { name: true } }, photos: { where: { kind: "thumb" }, take: 1, select: { bucketKey: true } } },
    orderBy: { copies: "desc" },
  });
  if (!stacks.length) return [];
  const wears = await db.wearLog.groupBy({ by: ["itemId"], where: { itemId: { in: stacks.map((s) => s.id) }, wornOn: { gte: since.toISOString().slice(0, 10) } }, _count: { _all: true } });
  const count = new Map(wears.map((w) => [w.itemId, w._count._all]));
  return stacks
    .map((s) => { const wears90 = count.get(s.id) ?? 0; return { id: s.id, name: s.name ?? "Untitled piece", thumbKey: s.photos[0]?.bucketKey ?? null, categoryName: s.category?.name ?? null, copies: s.copies, wears90, keep: Math.min(s.copies, copiesNeeded(wears90, cycleDays)), cycleDays }; })
    .filter((s) => s.keep < s.copies);
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
  const [list, stacks] = await Promise.all([listCleanOut(personId, now), listStacks(personId, now)]);
  return list.items.length + stacks.length;
}

/** Keep (snooze 3 months), Donate / Sell (retire), or Trim a stack down to `keep` copies. */
export async function cleanOutDecision(viewer: Viewer, itemId: string, decision: "keep" | "donate" | "sell" | "trim", now = new Date(), keep?: number): Promise<void> {
  const item = await db.item.findUnique({ where: { id: itemId }, select: { ownerId: true, copies: true, dirtyCopies: true, cleanersCopies: true, laundryStatus: true } });
  if (!item) throw new OutfitError("That piece is gone.", 404);
  if (!canEditItem(viewer, item.ownerId)) throw new OutfitError("Only the owner or an admin can decide that.", 403);
  if (decision === "trim") {
    const n = Math.floor(Number(keep));
    if (!Number.isFinite(n) || n < 1 || n >= item.copies) throw new OutfitError("Say how many to keep, fewer than you have.");
    const next = countsOf({ ...countsOf(item), copies: n, laundryStatus: item.laundryStatus });
    await db.item.update({ where: { id: itemId }, data: { ...next, laundryStatus: laundrySummary(next) } });
    return;
  }
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

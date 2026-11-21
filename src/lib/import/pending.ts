import { db } from "@/lib/db";
import type { StoreMeta } from "@/lib/store/add";

/** A piece that was just added and is not a card yet: tagging, or failed to tag. */
export type PendingCard = { id: string; batchId: string; status: "tagging" | "failed"; error: string | null; photoKey: string; name: string | null };
export type PendingAdds = { cards: PendingCard[]; /** Photos tagged and waiting for a look on the confirm page. */ toConfirm: { count: number; batchId: string } | null };

const EMPTY: PendingAdds = { cards: [], toConfirm: null };

/**
 * What the person added that has not landed in the closet yet (Jeff, 20 Nov 2026: a piece added from a store link
 * "never locked in the closet" because for 10 to 40 seconds nothing showed it was coming). Their own open batches only:
 * each queued or processing entry is a "Tagging" card, each failed one says why, and photos waiting to be confirmed
 * are one card that opens the confirm page.
 */
export async function pendingAdds(personId: string): Promise<PendingAdds> {
  const batches = await db.importBatch.findMany({ where: { personId, status: "open" }, select: { id: true } });
  if (!batches.length) return EMPTY;
  const batchIds = batches.map((b) => b.id);
  const entries = await db.importEntry.findMany({
    where: { batchId: { in: batchIds }, status: { in: ["queued", "uploaded", "processing", "failed", "needs_confirm"] } },
    orderBy: [{ createdAt: "desc" }, { order: "desc" }],
    select: { id: true, batchId: true, status: true, error: true, originalKey: true, storeMeta: true },
  });
  const waiting = entries.filter((e) => e.status === "needs_confirm");
  const cards: PendingCard[] = entries.filter((e) => e.status !== "needs_confirm").map((e) => ({
    id: e.id, batchId: e.batchId,
    status: e.status === "failed" ? "failed" : "tagging",
    error: e.status === "failed" ? e.error : null,
    photoKey: e.originalKey,
    name: (e.storeMeta as StoreMeta | null)?.name ?? null,
  }));
  return { cards, toConfirm: waiting.length ? { count: waiting.length, batchId: waiting[0].batchId } : null };
}

import { db } from "@/lib/db";
import type { StoreMeta } from "@/lib/store/add";
import type { EntryAiResult } from "@/lib/import/process";

/**
 * A piece that was just added and is not a real card yet.
 * - tagging: still on its way (queued, uploaded or processing); `since` says when it last moved so the card can say "Taking long".
 * - failed: tagging failed, with the reason; Try again / Remove.
 * - review: a store piece that could not land on its own (review B B6) and waits on the confirm page, with the reason.
 * - needs_category: a store piece that landed with no category (review B A2.2); tapping opens the piece to pick one.
 */
export type PendingCard = {
  id: string; batchId: string | null; status: "tagging" | "failed" | "review" | "needs_category"; error: string | null; photoKey: string | null; name: string | null;
  /** ISO time the entry last changed. */ since: string | null;
  /** For needs_category: the piece in the closet. */ itemId?: string;
  /** No picture from the store: the stand-in card is shown until the person adds one. */ noPhoto?: boolean;
};
export type PendingAdds = { cards: PendingCard[]; /** Photos tagged and waiting for a look on the confirm page. */ toConfirm: { count: number; batchId: string } | null };

const EMPTY: PendingAdds = { cards: [], toConfirm: null };

/**
 * What the person added that has not landed in the closet yet (Jeff, 20 Nov 2026: a piece added from a store link
 * "never locked in the closet" because for 10 to 40 seconds nothing showed it was coming). Their own open batches only.
 * Shown in every view of their own closet (review B A2.3): on a category tab only the pieces whose category is known
 * to be another one are left out; a piece whose category is still unknown shows on every tab.
 */
export async function pendingAdds(personId: string, opts: { categoryId?: string } = {}): Promise<PendingAdds> {
  const [batches, noCategory] = await Promise.all([
    db.importBatch.findMany({ where: { personId, status: "open" }, select: { id: true } }),
    // Store pieces that landed with no category (A2.2): a card in the closet until one is picked.
    db.item.findMany({ where: { ownerId: personId, categoryId: null, retiredAt: null, storePhoto: true }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, name: true, createdAt: true, aiConfidence: true, photos: { where: { kind: "thumb" }, take: 1, select: { bucketKey: true } } } }),
  ]);
  const cards: PendingCard[] = noCategory.map((it) => ({
    id: `item:${it.id}`, batchId: null, status: "needs_category", error: null, photoKey: it.photos[0]?.bucketKey ?? null, name: it.name, since: it.createdAt.toISOString(), itemId: it.id,
    noPhoto: ((it.aiConfidence as { warnings?: string[] } | null)?.warnings ?? []).includes("no_store_photo"),
  }));
  if (!batches.length) return cards.length ? { cards, toConfirm: null } : EMPTY;
  const batchIds = batches.map((b) => b.id);
  const entries = await db.importEntry.findMany({
    where: { batchId: { in: batchIds }, status: { in: ["queued", "uploaded", "processing", "failed", "needs_confirm"] } },
    orderBy: [{ createdAt: "desc" }, { order: "desc" }],
    select: { id: true, batchId: true, status: true, error: true, originalKey: true, thumbKey: true, storeMeta: true, aiResult: true, updatedAt: true },
  });
  const knownCategory = (e: (typeof entries)[number]) => (e.aiResult as EntryAiResult | null)?.tags?.categoryId ?? null;
  // On a category tab, a piece known to belong elsewhere is not shown; an unknown one is.
  const onThisTab = (e: (typeof entries)[number]) => { const c = knownCategory(e); return !opts.categoryId || !c || c === opts.categoryId; };
  const shown = entries.filter(onThisTab);
  const waiting = shown.filter((e) => e.status === "needs_confirm");
  const isStore = (e: (typeof entries)[number]) => { const m = e.storeMeta as StoreMeta | null; return Boolean(m && !m.matched); };
  // A store piece that was meant to land on its own but could not (B6) is its own card, with the reason.
  const review = waiting.filter((e) => isStore(e) && e.error);
  const toConfirm = waiting.filter((e) => !review.includes(e));
  for (const e of shown) {
    if (e.status === "needs_confirm" && !review.includes(e)) continue;
    const meta = e.storeMeta as StoreMeta | null;
    cards.push({
      id: e.id, batchId: e.batchId,
      status: e.status === "failed" ? "failed" : e.status === "needs_confirm" ? "review" : "tagging",
      error: e.status === "failed" || e.status === "needs_confirm" ? e.error : null,
      photoKey: e.thumbKey ?? e.originalKey,
      name: meta?.name ?? null,
      since: e.updatedAt.toISOString(),
      ...(meta?.noPhoto ? { noPhoto: true } : {}),
    });
  }
  return { cards, toConfirm: toConfirm.length ? { count: toConfirm.length, batchId: toConfirm[0].batchId } : null };
}

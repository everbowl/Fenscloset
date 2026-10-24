import { db } from "@/lib/db";
import { parseKey } from "@/lib/storage";
import { enqueueProcessing, isQueued } from "@/lib/import/queue";
import type { EntryStatus } from "@/generated/prisma/client";

export type BatchSummary = {
  id: string;
  total: number;
  counts: Record<EntryStatus, number>;
  /** Next entry waiting for a one-tap confirm, in pick order. */
  nextConfirmId: string | null;
  /** Position of nextConfirmId in the batch, 1-based, for the `042 / 150` chip. */
  position: number;
  /** Entries whose processing failed, with the plain-words reason. */
  failed: { id: string; error: string | null }[];
};

const STALE_MS = 3 * 60 * 1000;

/** One open batch per person. Picking more photos while one is open adds to it. */
export async function getOrCreateOpenBatch(personId: string, addTotal: number): Promise<{ id: string; startOrder: number; total: number }> {
  const open = await db.importBatch.findFirst({ where: { personId, status: "open" }, orderBy: { createdAt: "desc" }, include: { _count: { select: { entries: true } } } });
  if (open) {
    const updated = await db.importBatch.update({ where: { id: open.id }, data: { total: open.total + addTotal } });
    const last = await db.importEntry.aggregate({ where: { batchId: open.id }, _max: { order: true } });
    return { id: open.id, startOrder: (last._max.order ?? -1) + 1, total: updated.total };
  }
  const made = await db.importBatch.create({ data: { personId, total: addTotal } });
  return { id: made.id, startOrder: 0, total: made.total };
}

export class ImportError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ImportError";
  }
}

/** Called once a photo is in the bucket. Queues processing right away. */
export async function registerEntry(personId: string, batchId: string, key: string, order: number): Promise<{ id: string }> {
  const parsed = parseKey(key);
  if (!parsed || parsed.kind !== "originals" || parsed.ownerId !== personId) throw new ImportError("That photo does not belong to you.", 403);
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.personId !== personId) throw new ImportError("That batch is not yours.", 403);
  if (batch.status !== "open") throw new ImportError("That batch is finished.", 409);
  const existing = await db.importEntry.findFirst({ where: { originalKey: key } });
  if (existing) return { id: existing.id };
  const entry = await db.importEntry.create({ data: { batchId, order, originalKey: key, status: "uploaded" } });
  enqueueProcessing(entry.id);
  return { id: entry.id };
}

export async function retryEntry(personId: string, entryId: string): Promise<void> {
  const entry = await db.importEntry.findUnique({ where: { id: entryId }, include: { batch: true } });
  if (!entry || entry.batch.personId !== personId) throw new ImportError("Not yours.", 403);
  if (!["failed", "uploaded", "queued", "processing"].includes(entry.status)) throw new ImportError("Nothing to retry.", 409);
  await db.importEntry.update({ where: { id: entryId }, data: { status: "uploaded", error: null } });
  enqueueProcessing(entryId);
}

/** The open batch with live counts. Re-queues work left mid-flight by a restart. */
export async function openBatch(personId: string): Promise<BatchSummary | null> {
  const batch = await db.importBatch.findFirst({ where: { personId, status: "open" }, orderBy: { createdAt: "desc" } });
  if (!batch) return null;
  const entries = await db.importEntry.findMany({ where: { batchId: batch.id }, orderBy: { order: "asc" }, select: { id: true, status: true, error: true, updatedAt: true, order: true } });
  const counts: Record<EntryStatus, number> = { queued: 0, uploaded: 0, processing: 0, needs_confirm: 0, done: 0, failed: 0, skipped: 0 };
  for (const e of entries) counts[e.status]++;
  const stale = Date.now() - STALE_MS;
  for (const e of entries) {
    if ((e.status === "uploaded" || e.status === "queued") && !isQueued(e.id)) enqueueProcessing(e.id);
    else if (e.status === "processing" && !isQueued(e.id) && e.updatedAt.getTime() < stale) enqueueProcessing(e.id);
  }
  const next = entries.find((e) => e.status === "needs_confirm") ?? null;
  const settled = entries.filter((e) => e.status === "done" || e.status === "skipped").length;
  return {
    id: batch.id,
    total: Math.max(batch.total, entries.length),
    counts,
    nextConfirmId: next?.id ?? null,
    position: next ? settled + 1 : settled,
    failed: entries.filter((e) => e.status === "failed").map((e) => ({ id: e.id, error: e.error })),
  };
}

/** Closes a batch once nothing is left to confirm (or the person abandons it). */
export async function finishBatchIfDone(batchId: string): Promise<boolean> {
  const left = await db.importEntry.count({ where: { batchId, status: { in: ["queued", "uploaded", "processing", "needs_confirm"] } } });
  if (left > 0) return false;
  await db.importBatch.update({ where: { id: batchId }, data: { status: "done" } });
  return true;
}

export async function abandonBatch(personId: string, batchId: string): Promise<void> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.personId !== personId) throw new ImportError("Not yours.", 403);
  await db.importEntry.updateMany({ where: { batchId, status: { in: ["queued", "uploaded", "processing", "needs_confirm", "failed"] } }, data: { status: "skipped" } });
  await db.importBatch.update({ where: { id: batchId }, data: { status: "done" } });
}

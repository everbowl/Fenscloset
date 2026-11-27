import { db } from "@/lib/db";
import { getObject, newKey, parseKey, putObject } from "@/lib/storage";
import { makeThumb } from "@/lib/images/thumb";
import { enqueueProcessing, isQueued } from "@/lib/import/queue";
import type { EntryStatus } from "@/generated/prisma/client";
import type { StoreMeta } from "@/lib/store/add";

/** One row of the Add screen's list while a batch runs: what the photo is, where it is, and when it last moved. */
export type EntryRow = { id: string; status: EntryStatus; /** A small picture for the row: the early thumb, else the upload. */ photoKey: string; name: string | null; error: string | null; /** ISO time of the last state change, so the screen can say "Taking long". */ since: string };

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
  /** Entries still being tagged, oldest first, with when they started: the Waiting screen offers Try again / Skip past a minute. */
  working: { id: string; since: string }[];
  /** The newest rows (uploaded, tagging, ready, failed), for the Add screen's list. Done and skipped ones are left out. */
  rows: EntryRow[];
};

const STALE_MS = 3 * 60 * 1000;
const ROWS_SHOWN = 60;

/**
 * One open batch per person. Picking more photos while one is open adds to it. A negative `addTotal` takes picks back
 * (uploads that failed and were removed, review B B9); the total never drops under what has actually arrived.
 */
export async function getOrCreateOpenBatch(personId: string, addTotal: number): Promise<{ id: string; startOrder: number; total: number }> {
  const open = await db.importBatch.findFirst({ where: { personId, status: "open" }, orderBy: { createdAt: "desc" } });
  if (open) {
    const [last, count] = await Promise.all([db.importEntry.aggregate({ where: { batchId: open.id }, _max: { order: true } }), db.importEntry.count({ where: { batchId: open.id } })]);
    const updated = await db.importBatch.update({ where: { id: open.id }, data: { total: Math.max(count, open.total + addTotal) } });
    return { id: open.id, startOrder: (last._max.order ?? -1) + 1, total: updated.total };
  }
  const made = await db.importBatch.create({ data: { personId, total: Math.max(0, addTotal) } });
  return { id: made.id, startOrder: 0, total: made.total };
}

export class ImportError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ImportError";
  }
}

/**
 * A 400 px thumbnail of the upload before tagging starts (review B B13): the Tagging card and the Add screen's rows
 * show this instead of pulling the 1600 px original through the photo proxy. Tagging writes its own thumb later and
 * drops this one. Never fails the register: no thumb is just a slower picture.
 */
async function earlyThumb(personId: string, originalKey: string): Promise<string | null> {
  try {
    const thumbKey = newKey("thumbs", personId, "image/jpeg");
    await putObject(thumbKey, await makeThumb((await getObject(originalKey)).body), "image/jpeg");
    return thumbKey;
  } catch { return null; }
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
  const thumbKey = await earlyThumb(personId, key);
  const entry = await db.importEntry.create({ data: { batchId, order, originalKey: key, thumbKey, status: "uploaded" } });
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

const LIVE: EntryStatus[] = ["queued", "uploaded", "processing", "needs_confirm", "failed"];

/**
 * The open batch with live counts. With `batchId`, that batch (the page the person is on, review B B10); without,
 * the open batch that still has work in it, else the newest. Re-queues work left mid-flight by a restart, and closes
 * a batch nothing ever landed in (every upload failed and was removed, review B B9) once it has sat empty a while.
 */
export async function openBatch(personId: string, batchId?: string): Promise<BatchSummary | null> {
  let batch = batchId
    ? await db.importBatch.findFirst({ where: { id: batchId, personId, status: "open" } })
    : null;
  if (!batch && !batchId) {
    const open = await db.importBatch.findMany({ where: { personId, status: "open" }, orderBy: { createdAt: "desc" } });
    if (open.length > 1) {
      const live = await db.importEntry.groupBy({ by: ["batchId"], where: { batchId: { in: open.map((b) => b.id) }, status: { in: LIVE } }, _count: { _all: true } });
      batch = open.find((b) => live.some((l) => l.batchId === b.id)) ?? open[0];
    } else batch = open[0] ?? null;
  }
  if (!batch) return null;
  const entries = await db.importEntry.findMany({ where: { batchId: batch.id }, orderBy: { order: "asc" }, select: { id: true, status: true, error: true, updatedAt: true, order: true, originalKey: true, thumbKey: true, storeMeta: true } });
  if (entries.length === 0 && Date.now() - batch.updatedAt.getTime() > STALE_MS) {
    await db.importBatch.update({ where: { id: batch.id }, data: { status: "done" } });
    return null;
  }
  const counts: Record<EntryStatus, number> = { queued: 0, uploaded: 0, processing: 0, needs_confirm: 0, done: 0, failed: 0, skipped: 0 };
  for (const e of entries) counts[e.status]++;
  const stale = Date.now() - STALE_MS;
  for (const e of entries) {
    if ((e.status === "uploaded" || e.status === "queued") && !isQueued(e.id)) enqueueProcessing(e.id);
    else if (e.status === "processing" && !isQueued(e.id) && e.updatedAt.getTime() < stale) enqueueProcessing(e.id);
  }
  const next = entries.find((e) => e.status === "needs_confirm") ?? null;
  const settled = entries.filter((e) => e.status === "done" || e.status === "skipped").length;
  const live = entries.filter((e) => LIVE.includes(e.status));
  return {
    id: batch.id,
    total: Math.max(batch.total, entries.length),
    counts,
    nextConfirmId: next?.id ?? null,
    position: next ? settled + 1 : settled,
    failed: entries.filter((e) => e.status === "failed").map((e) => ({ id: e.id, error: e.error })),
    working: entries.filter((e) => e.status === "queued" || e.status === "uploaded" || e.status === "processing").map((e) => ({ id: e.id, since: e.updatedAt.toISOString() })),
    rows: live.slice(-ROWS_SHOWN).reverse().map((e) => ({ id: e.id, status: e.status, photoKey: e.thumbKey ?? e.originalKey, name: (e.storeMeta as StoreMeta | null)?.name ?? null, error: e.error, since: e.updatedAt.toISOString() })),
  };
}

/** Closes a batch once nothing is left to confirm (or the person abandons it). Failed photos keep it open so they are not lost: Try again or Let them go. */
export async function finishBatchIfDone(batchId: string): Promise<boolean> {
  const left = await db.importEntry.count({ where: { batchId, status: { in: LIVE } } });
  if (left > 0) return false;
  await db.importBatch.update({ where: { id: batchId }, data: { status: "done" } });
  return true;
}

export async function abandonBatch(personId: string, batchId: string): Promise<void> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.personId !== personId) throw new ImportError("Not yours.", 403);
  await db.importEntry.updateMany({ where: { batchId, status: { in: LIVE } }, data: { status: "skipped" } });
  await db.importBatch.update({ where: { id: batchId }, data: { status: "done" } });
}

/**
 * Server start (src/instrumentation.ts, review B A2.5): every entry a restart left `processing`, `uploaded` or
 * `queued` goes back on the queue at once, instead of waiting for someone to open the Add screen three minutes
 * later. Returns how many it queued; never throws.
 */
export async function requeueUnfinished(): Promise<number> {
  try {
    const left = await db.importEntry.findMany({ where: { status: { in: ["queued", "uploaded", "processing"] }, batch: { status: "open" } }, select: { id: true }, orderBy: { createdAt: "asc" } });
    for (const e of left) enqueueProcessing(e.id);
    if (left.length) console.log(`import: ${left.length} ${left.length === 1 ? "photo" : "photos"} left mid-way by the last run, tagging again`);
    return left.length;
  } catch (e) {
    console.error("import: could not requeue unfinished entries", e);
    return 0;
  }
}

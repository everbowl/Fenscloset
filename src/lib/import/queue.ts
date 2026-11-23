import { processEntry } from "@/lib/import/process";
import { db } from "@/lib/db";

/**
 * In-process worker: at most CONCURRENCY entries run through remove.bg + Claude at once, so a 150-photo batch never
 * floods the APIs. It lives in the long-running Node process (Railway), not in a request: the route handler only
 * calls enqueueProcessing() and answers. After a restart, requeueUnfinished() (src/instrumentation.ts) and openBatch()
 * pick up anything left mid-flight.
 *
 * Watchdog (review B A2.4): an entry in flight for longer than STUCK_MS is dropped from the slots and marked failed, so
 * one hung outside call can never hold the family's pipeline; the Tagging card then offers Try again. Every outside
 * call has its own timeout too (remove.bg 45 s, Claude 60 s × 2, the bucket 60 s), so this is the last line.
 */
const CONCURRENCY = 3; // three once every outside call has a timeout (review B B3)
export const STUCK_MS = 3 * 60 * 1000;
const REAP_EVERY_MS = 30 * 1000;
export const STUCK_MESSAGE = "Tagging took too long. Try again.";

const queued: string[] = [];
const inFlight = new Map<string, number>(); // entry id → when it started
let reaper: ReturnType<typeof setInterval> | null = null;

export function enqueueProcessing(entryId: string): void {
  if (inFlight.has(entryId) || queued.includes(entryId)) return;
  queued.push(entryId);
  startReaper();
  pump();
}

export function isQueued(entryId: string): boolean {
  return inFlight.has(entryId) || queued.includes(entryId);
}

function pump() {
  while (inFlight.size < CONCURRENCY && queued.length) {
    const id = queued.shift()!;
    inFlight.set(id, Date.now());
    processEntry(id)
      .catch(() => { /* processEntry records its own failure */ })
      .finally(() => { inFlight.delete(id); pump(); });
  }
}

function startReaper() {
  if (reaper) return;
  reaper = setInterval(() => { void reapStuck(); }, REAP_EVERY_MS);
  (reaper as { unref?: () => void }).unref?.(); // never keeps the process alive on its own
}

/**
 * Drops every in-flight entry older than `olderThanMs` and marks it failed with a plain reason. The abandoned
 * processEntry() may still finish later; its final write is guarded on status "processing", so a late answer cannot
 * overwrite the failure (and a retry that already started is not undone). Returns the ids it dropped; tests call it.
 */
export async function reapStuck(olderThanMs = STUCK_MS, now = Date.now()): Promise<string[]> {
  const stuck = [...inFlight.entries()].filter(([, startedAt]) => now - startedAt > olderThanMs).map(([id]) => id);
  for (const id of stuck) {
    inFlight.delete(id);
    try {
      await db.importEntry.updateMany({ where: { id, status: "processing" }, data: { status: "failed", error: STUCK_MESSAGE } });
      console.error(`import: entry ${id} dropped after ${Math.round(olderThanMs / 1000)} s in flight`);
    } catch (e) { console.error(`import: could not mark ${id} failed`, e); }
  }
  if (stuck.length) pump();
  return stuck;
}

/** Waits for the queue to drain; tests use it. */
export async function drainQueue(): Promise<void> {
  while (inFlight.size || queued.length) await new Promise((r) => setTimeout(r, 25));
}

/** Tests: pretend an in-flight entry started `ms` ago. */
export function _backdateInFlight(entryId: string, ms: number): void {
  if (inFlight.has(entryId)) inFlight.set(entryId, Date.now() - ms);
}

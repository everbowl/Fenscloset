import { processEntry } from "@/lib/import/process";

/**
 * In-process worker: at most CONCURRENCY entries run through remove.bg + Claude at once, so a
 * 150-photo batch never floods the APIs. Survives the request because route handlers hand entries
 * over with `after()`. After a restart, `openBatch()` re-queues anything left mid-flight.
 */
const CONCURRENCY = 2;
const queued: string[] = [];
const inFlight = new Set<string>();

export function enqueueProcessing(entryId: string): void {
  if (inFlight.has(entryId) || queued.includes(entryId)) return;
  queued.push(entryId);
  pump();
}

export function isQueued(entryId: string): boolean {
  return inFlight.has(entryId) || queued.includes(entryId);
}

function pump() {
  while (inFlight.size < CONCURRENCY && queued.length) {
    const id = queued.shift()!;
    inFlight.add(id);
    processEntry(id)
      .catch(() => { /* processEntry records its own failure */ })
      .finally(() => { inFlight.delete(id); pump(); });
  }
}

/** Waits for the queue to drain; tests use it. */
export async function drainQueue(): Promise<void> {
  while (inFlight.size || queued.length) await new Promise((r) => setTimeout(r, 25));
}

import type { TryOnView } from "@/lib/tryon";

/**
 * A look is dressed in the background (Jeff, 19 Oct 2026: his phone gave up on a 37-second request while
 * the mirror was still dressing). The screen starts a dressing, gets a job id back right away unless the
 * picture is quick (a cached one), and polls for it. The job carries on when the browser lets go; its
 * picture is cached by tryOnLook / mannequinLook, so it is waiting when the person comes back. One job
 * runs per key (person + pieces + choices); a second request for the same key joins it.
 *
 * In-process on purpose: one web process on Railway, and a dressing is worth nothing after a restart
 * (the next request simply dresses the look again).
 */

export type DressingStatus =
  | { state: "running"; step: string; startedAt: number }
  | { state: "done"; tryOn: TryOnView }
  | { state: "failed"; error: Error };

export type Dressing = { id: string; key: string; ownerId: string; startedAt: number; status: DressingStatus; promise: Promise<void> };

const byId = new Map<string, Dressing>();
const running = new Map<string, Dressing>();
/** A finished job stays readable for a while, for a phone that comes back late. */
const KEEP_MS = 10 * 60 * 1000;
const FIRST_STEP = "Getting ready…";

const randomId = () => `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Starts dressing under `key` for `ownerId` (the person who may read it), or joins the job already running under that key. */
export function startDressing(key: string, ownerId: string, fn: (step: (s: string) => void) => Promise<TryOnView>): Dressing {
  const live = running.get(key);
  if (live) return live;
  const startedAt = Date.now();
  const job: Dressing = { id: randomId(), key, ownerId, startedAt, status: { state: "running", step: FIRST_STEP, startedAt }, promise: Promise.resolve() };
  job.promise = fn((s) => { if (job.status.state === "running") job.status = { state: "running", step: s, startedAt }; })
    .then(
      (tryOn) => { job.status = { state: "done", tryOn }; },
      (e: unknown) => { job.status = { state: "failed", error: e instanceof Error ? e : new Error(String(e)) }; },
    )
    .finally(() => {
      if (running.get(key) === job) running.delete(key);
      const t = setTimeout(() => { if (byId.get(job.id) === job) byId.delete(job.id); }, KEEP_MS);
      (t as { unref?: () => void }).unref?.();
    });
  byId.set(job.id, job);
  running.set(key, job);
  return job;
}

/** The job's state, for its owner only (a person's dressing is theirs alone). Null: unknown, someone else's, or long gone. */
export function dressingStatus(id: string, ownerId: string): DressingStatus | null {
  const job = byId.get(id);
  return job && job.ownerId === ownerId ? job.status : null;
}

/** Waits up to `ms` for the job, so a quick dressing (a cached picture) comes back in the same call. */
export async function settled(job: Dressing, ms: number): Promise<DressingStatus> {
  await Promise.race([job.promise, new Promise<void>((r) => { const t = setTimeout(r, ms); (t as { unref?: () => void }).unref?.(); })]);
  return job.status;
}

/** How many jobs are running right now (for a health line and tests). */
export function dressingsRunning(): number {
  return running.size;
}

/** Tests: forget every job. */
export function forgetDressings(): void {
  byId.clear();
  running.clear();
}

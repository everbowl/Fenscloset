/**
 * Slow work runs in the background (Jeff, 19 Oct 2026: his phone gave up on a 37-second mirror request,
 * then on a 23-second Today page that was building the day's looks inside the page load). A screen
 * starts a job, gets a job id back right away unless the work is quick, and polls for it. The job carries
 * on when the browser lets go; its result is saved by the work itself (a TryOn row, an OutfitSuggestion),
 * so it is waiting when the person comes back. One job runs per key; a second request for the same key
 * joins it.
 *
 * In-process on purpose: one web process on Railway, and a job is worth nothing after a restart (the
 * next request simply starts the work again).
 */

export type JobStatus<T> =
  | { state: "running"; step: string; startedAt: number }
  | { state: "done"; result: T }
  | { state: "failed"; error: Error };

export type Job<T> = { id: string; key: string; ownerId: string; startedAt: number; status: JobStatus<T>; promise: Promise<void> };

const byId = new Map<string, Job<unknown>>();
const running = new Map<string, Job<unknown>>();
/** A finished job stays readable for a while, for a phone that comes back late. */
const KEEP_MS = 10 * 60 * 1000;
const FIRST_STEP = "Getting ready…";

const randomId = () => `j_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Starts `fn` under `key` for `ownerId` (the person who may read it), or joins the job already running under that key. */
export function startJob<T>(key: string, ownerId: string, fn: (step: (s: string) => void) => Promise<T>): Job<T> {
  const live = running.get(key);
  if (live) return live as Job<T>;
  const startedAt = Date.now();
  const job: Job<T> = { id: randomId(), key, ownerId, startedAt, status: { state: "running", step: FIRST_STEP, startedAt }, promise: Promise.resolve() };
  job.promise = fn((s) => { if (job.status.state === "running") job.status = { state: "running", step: s, startedAt }; })
    .then(
      (result) => { job.status = { state: "done", result }; },
      (e: unknown) => { job.status = { state: "failed", error: e instanceof Error ? e : new Error(String(e)) }; },
    )
    .finally(() => {
      if (running.get(key) === job) running.delete(key);
      const t = setTimeout(() => { if (byId.get(job.id) === job) byId.delete(job.id); }, KEEP_MS);
      (t as { unref?: () => void }).unref?.();
    });
  byId.set(job.id, job as Job<unknown>);
  running.set(key, job as Job<unknown>);
  return job;
}

/** The job's state, for its owner only. Null: unknown, someone else's, or long gone. */
export function jobStatus<T>(id: string, ownerId: string): JobStatus<T> | null {
  const job = byId.get(id);
  return job && job.ownerId === ownerId ? (job.status as JobStatus<T>) : null;
}

/** Waits up to `ms` for the job, so quick work comes back in the same call. */
export async function settled<T>(job: Job<T>, ms: number): Promise<JobStatus<T>> {
  await Promise.race([job.promise, new Promise<void>((r) => { const t = setTimeout(r, ms); (t as { unref?: () => void }).unref?.(); })]);
  return job.status;
}

/** How many jobs are running right now (for a health line and tests). */
export function jobsRunning(): number {
  return running.size;
}

/** Tests: forget every job. */
export function forgetJobs(): void {
  byId.clear();
  running.clear();
}

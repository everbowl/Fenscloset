"use server";

import { requirePerson } from "@/lib/auth/current";
import { jobStatus, settled, type JobStatus } from "@/lib/jobs";
import { ShopError } from "@/lib/shop/engine";
import { getGoWith, latestGoWith, startGoWith, type GoWithView } from "@/lib/shop/go-with";
import type { Viewer } from "@/lib/people/visibility";

/** The answer when it is already there or quick, else a job to poll with goWithStatusAction. */
export type GoWithResult =
  | { ok: true; view: GoWithView }
  | { ok: true; pending: { jobId: string; step: string; startedAt: number } }
  | { ok: false; error: string };

const QUICK_MS = 1500;

function failed(e: unknown): { ok: false; error: string } {
  if (e instanceof ShopError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Try again." };
}

async function answer(me: Viewer, status: JobStatus<string>, jobId: string): Promise<GoWithResult> {
  if (status.state === "done") {
    const view = await getGoWith(me, status.result);
    return view ? { ok: true, view } : { ok: false, error: "That answer is gone. Try again." };
  }
  if (status.state === "failed") return failed(status.error);
  return { ok: true, pending: { jobId, step: status.step, startedAt: status.startedAt } };
}

/** Today's answer for the piece if there is one (unless `fresh`), else the work starts in the background. */
export async function goWithAction(itemId: string, fresh = false): Promise<GoWithResult> {
  const me = await requirePerson();
  try {
    if (!fresh) {
      const have = await latestGoWith(me, itemId);
      if (have) return { ok: true, view: have };
    }
    const job = startGoWith(me, itemId);
    return answer(me, await settled(job, QUICK_MS), job.id);
  } catch (e) {
    return failed(e);
  }
}

export async function goWithStatusAction(jobId: string): Promise<GoWithResult> {
  const me = await requirePerson();
  const status = jobStatus<string>(jobId, me.id);
  if (!status) return { ok: false, error: "That search is gone. Try again." };
  return answer(me, status, jobId);
}

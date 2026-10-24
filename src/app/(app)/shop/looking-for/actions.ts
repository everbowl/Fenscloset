"use server";

import { requirePerson } from "@/lib/auth/current";
import { jobStatus, settled, type JobStatus } from "@/lib/jobs";
import { ShopError } from "@/lib/shop/engine";
import { addWant, deleteWant, editWant, searchWantNow, setWantFound } from "@/lib/shop/wants";

/**
 * A want's search runs in the background: the answer is the want's id when it was quick (the mocks), else a job
 * for the screen to poll with wantStatusAction. The row is saved first, so the list shows it even if the browser lets go.
 */
export type WantResult =
  | { ok: true; id: string; pending?: { jobId: string; step: string; startedAt: number } }
  | { ok: false; error: string };

export type Result = { ok: true } | { ok: false; error: string };

const QUICK_MS = 1500;

function failed(e: unknown): { ok: false; error: string } {
  if (e instanceof ShopError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Try again." };
}

// No revalidatePath in these actions: the screens refresh the page themselves. A revalidate inside the action would
// render the page once more in the action's own response, and openWant would count the new matches as seen before
// the person saw them.
function answer(id: string, status: JobStatus<string>, jobId: string): WantResult {
  if (status.state === "done") return { ok: true, id };
  if (status.state === "failed") return failed(status.error);
  return { ok: true, id, pending: { jobId, step: status.step, startedAt: status.startedAt } };
}

export async function addWantAction(forPersonId: string, text: string): Promise<WantResult> {
  const me = await requirePerson();
  try {
    const { id, job } = await addWant(me, forPersonId, text);
    return answer(id, await settled(job, QUICK_MS), job.id);
  } catch (e) { return failed(e); }
}

export async function editWantAction(wantId: string, text: string): Promise<WantResult> {
  const me = await requirePerson();
  try {
    const job = await editWant(me, wantId, text);
    return answer(wantId, await settled(job, QUICK_MS), job.id);
  } catch (e) { return failed(e); }
}

export async function searchWantAction(wantId: string): Promise<WantResult> {
  const me = await requirePerson();
  try {
    const job = await searchWantNow(me, wantId);
    return answer(wantId, await settled(job, QUICK_MS), job.id);
  } catch (e) { return failed(e); }
}

/** Where a want's search stands: still running (with its step), or done. */
export async function wantStatusAction(wantId: string, jobId: string): Promise<WantResult> {
  const me = await requirePerson();
  const status = jobStatus<string>(jobId, me.id);
  if (!status) return { ok: false, error: "That search is gone. Try again." };
  return answer(wantId, status, jobId);
}

export async function foundWantAction(wantId: string, found: boolean): Promise<Result> {
  const me = await requirePerson();
  try { await setWantFound(me, wantId, found); return { ok: true }; }
  catch (e) { return failed(e); }
}

export async function deleteWantAction(wantId: string): Promise<Result> {
  const me = await requirePerson();
  try { await deleteWant(me, wantId); return { ok: true }; }
  catch (e) { return failed(e); }
}

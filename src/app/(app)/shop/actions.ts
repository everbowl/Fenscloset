"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { deleteLookup, getLookup, ShopError, startLookup, type LookupInput } from "@/lib/shop/engine";
import { getObject, IMAGE_TYPES } from "@/lib/storage";
import { jobStatus, settled, type JobStatus } from "@/lib/jobs";
import { tryOnLook, tryOnState, TryOnError, type TryOnView } from "@/lib/tryon";
import { featuresOf } from "@/lib/tryon/features";
import { isMannequinConfigured, mannequinLook } from "@/lib/tryon/mannequin";

export type Result = { ok: true; id?: string } | { ok: false; error: string };

/**
 * A lookup answers with the saved lookup's id when it is quick (the same input again, or the mocks), else with a
 * job for the screen to poll with lookupStatusAction. The work carries on if the browser lets go; its answer
 * is saved and waits under Recent.
 */
export type LookupResult =
  | { ok: true; id: string }
  | { ok: true; pending: { jobId: string; step: string; startedAt: number } }
  | { ok: false; error: string };

/** How long the first call waits before handing back a job to poll. */
const QUICK_MS = 1500;

function failed(e: unknown): { ok: false; error: string } {
  if (e instanceof ShopError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Try again." };
}

function answer(status: JobStatus<string>, jobId: string): LookupResult {
  if (status.state === "done") { revalidatePath("/shop"); return { ok: true, id: status.result }; }
  if (status.state === "failed") return failed(status.error);
  return { ok: true, pending: { jobId, step: status.step, startedAt: status.startedAt } };
}

async function begin(forPersonId: string, input: LookupInput): Promise<LookupResult> {
  const me = await requirePerson();
  const job = startLookup(me, forPersonId, input);
  return answer(await settled(job, QUICK_MS), job.id);
}

export async function lookupLinkAction(forPersonId: string, url: string): Promise<LookupResult> {
  return begin(forPersonId, { source: "link", url });
}

/** form: `photo` (file) + `source` ("screenshot" | "photo") */
export async function lookupPhotoAction(forPersonId: string, form: FormData): Promise<LookupResult> {
  const file = form.get("photo");
  const source = form.get("source") === "photo" ? "photo" : "screenshot";
  if (!(file instanceof File) || !IMAGE_TYPES[file.type]) return { ok: false, error: "Use a JPEG, PNG or WebP image." };
  if (file.size > 12 * 1024 * 1024) return { ok: false, error: "That image is too large." };
  return begin(forPersonId, { source, data: Buffer.from(await file.arrayBuffer()), contentType: file.type as "image/jpeg" });
}

/** Where a lookup stands: still running (with its step), done (the lookup's id), or failed (why). */
export async function lookupStatusAction(jobId: string): Promise<LookupResult> {
  const me = await requirePerson();
  const status = jobStatus<string>(jobId, me.id);
  if (!status) return { ok: false, error: "That lookup is gone. Try again." };
  return answer(status, jobId);
}

export async function deleteLookupAction(id: string): Promise<Result> {
  const me = await requirePerson();
  try { await deleteLookup(me, id); revalidatePath("/shop"); return { ok: true }; }
  catch (e) { return failed(e); }
}

/** SEE IT ON: the candidate piece (its store photo) on the person's own body photo when their try-on is ready, else on the shared mannequin (V A), with the first pairing's other pieces. */
export async function tryOnLookupAction(lookupId: string): Promise<Result & { tryOn?: TryOnView }> {
  const me = await requirePerson();
  try {
    const v = await getLookup(me, lookupId);
    if (!v) return { ok: false, error: "That lookup is gone." };
    if (!v.imageKey) return { ok: false, error: "No picture of the piece to try on." };
    const others = v.pairings[0]?.itemIds.filter((id) => id !== "candidate") ?? [];
    const garment = (await getObject(v.imageKey)).body;
    const own = (await tryOnState(me, v.forPersonId)) === "ready";
    const extra = [...featuresOf({ category: v.read.categoryName })]; // the candidate is not an item: its category says whether it is a top, a bottom, an outer layer
    const tryOn = own ? await tryOnLook(me, v.forPersonId, others.slice(0, 2), `shop:${lookupId}`, garment, "front", undefined, extra)
      : isMannequinConfigured() ? await mannequinLook(me, v.forPersonId, others.slice(0, 2), `shop:${lookupId}`, garment, undefined, undefined, extra)
      : await tryOnLook(me, v.forPersonId, others.slice(0, 2), `shop:${lookupId}`, garment, "front", undefined, extra); // throws with the reason
    return { ok: true, tryOn };
  } catch (e) {
    if (e instanceof TryOnError || e instanceof ShopError) return { ok: false, error: e.message };
    console.error(e); return { ok: false, error: "The try-on didn’t come back. Try again." };
  }
}

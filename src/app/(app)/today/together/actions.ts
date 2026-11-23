"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { loadToday } from "@/lib/today/context";
import { loadWeather } from "@/lib/today/weather";
import { createTogether } from "@/lib/outfits/together";
import { OutfitError, wearBoard } from "@/lib/outfits/engine";
import { AiError } from "@/lib/ai/claude";
import { jobStatus, settled, startJob, type JobStatus } from "@/lib/jobs";
import type { TogetherMode } from "@/generated/prisma/client";

export type Result = { ok: true; id?: string } | { ok: false; error: string };
/** Dressing everyone: done (the session to show), or a job to poll with togetherStatusAction. */
export type TogetherResult = { ok: true; id: string } | { ok: true; pending: { jobId: string; step: string; startedAt: number } } | { ok: false; error: string };

/** How long the first call waits before handing back a job to poll. */
const QUICK_MS = 1500;

function failed(e: unknown): { ok: false; error: string } {
  if (e instanceof OutfitError) return { ok: false, error: e.message };
  if (e instanceof AiError) {
    console.error(`together: ai ${e.code}: ${e.message}`);
    return { ok: false, error: e.code === "no_key" ? "Looks aren’t set up yet (no AI key). A parent admin can add one on the server." : "Couldn’t dress everyone. Try again." };
  }
  console.error(e);
  return { ok: false, error: "Something went wrong. Try again." };
}

function answer(status: JobStatus<string>, jobId: string): TogetherResult {
  if (status.state === "done") { revalidatePath("/today/together"); revalidatePath("/today"); return { ok: true, id: status.result }; }
  if (status.state === "failed") return failed(status.error);
  return { ok: true, pending: { jobId, step: status.step, startedAt: status.startedAt } };
}

/**
 * Dress everyone in the background (src/lib/jobs.ts), like Today's looks: one Claude call over two to four closets is
 * 15 to 40 seconds, and a server action that long is what a sleeping phone drops (review D 8.1). The weather is read
 * inside the job; the plan is only the one picked here (review D 8.4).
 */
export async function dressTogetherAction(input: { personIds: string[]; mode: TogetherMode; occasionId?: string | null; occasionText?: string | null }): Promise<TogetherResult> {
  const me = await requirePerson();
  try {
    const day = await loadToday(me.id);
    const ids = [...new Set(input.personIds)].sort();
    // The same ask twice (a second tap while the first builds) joins the running job.
    const key = ["together", me.id, day.date, ids.join(","), input.mode, input.occasionId ?? "", input.occasionText?.trim() ?? ""].join("|");
    const job = startJob<string>(key, me.id, async (step) => {
      step("Checking the weather…");
      const { weather } = await loadWeather(day);
      const t = await createTogether(me, { personIds: ids, mode: input.mode, occasionId: input.occasionId, occasionText: input.occasionText, date: day.date, ctx: { weather, plan: { source: "none", occasionId: null, label: null }, checkIn: null, now: day.now }, step });
      return t.id;
    });
    return answer(await settled(job, QUICK_MS), job.id);
  } catch (e) {
    return failed(e);
  }
}

/** Where a Together build stands: still running (with its step), done (the session), or failed (why). */
export async function togetherStatusAction(jobId: string): Promise<TogetherResult> {
  const me = await requirePerson();
  const status = jobStatus<string>(jobId, me.id);
  if (!status) return { ok: false, error: "That build got lost on the way. Try again." };
  return answer(status, jobId);
}

export async function wearTogetherAction(personId: string, suggestionId: string, title: string): Promise<Result> {
  const me = await requirePerson();
  try {
    await wearBoard(me, personId, suggestionId, 0, title);
    revalidatePath("/today/together"); revalidatePath("/today"); revalidatePath("/fits");
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

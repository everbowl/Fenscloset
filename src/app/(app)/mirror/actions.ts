"use server";

import { requirePerson } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { OutfitError } from "@/lib/outfits/engine";
import { tryOnLook, TryOnError, type TryOnView } from "@/lib/tryon";
import { mannequinLook } from "@/lib/tryon/mannequin";
import { dressingStatus, settled, startDressing, type DressingStatus } from "@/lib/tryon/jobs";
import type { StylingChoice } from "@/lib/tryon/features";

/**
 * The mirror, from any screen: Today (a board of the day's suggestion) or the closet (pieces the person
 * picked, or one piece from its page). Dressing runs in the background (src/lib/tryon/jobs.ts): the first
 * call answers with the picture when it is quick, else with a job to poll.
 */

export type MirrorLook = { kind: "today"; suggestionId: string; index: number } | { kind: "closet"; itemIds: string[] };
export type MirrorRequest = {
  personId: string;
  look: MirrorLook;
  /** On the person's own body photo, or on the shared mannequin. */
  on: "me" | "mannequin";
  view?: "front" | "back";
  /** A styling chip the person just tapped (pose, tuck, buttons…). */
  pick?: StylingChoice;
  /** "Dress again": throw the saved pictures away first. */
  fresh?: boolean;
};
export type MirrorResult =
  | { ok: true; tryOn: TryOnView }
  | { ok: true; pending: { jobId: string; step: string; startedAt: number } }
  | { ok: false; error: string };

/** How long the first call waits before handing back a job to poll: a cached picture answers at once. */
const QUICK_MS = 1500;

function failed(e: unknown): MirrorResult {
  if (e instanceof TryOnError || e instanceof OutfitError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "The mirror didn’t come back. Try again." };
}

function answer(status: DressingStatus, jobId: string): MirrorResult {
  if (status.state === "done") return { ok: true, tryOn: status.tryOn };
  if (status.state === "failed") return failed(status.error);
  return { ok: true, pending: { jobId, step: status.step, startedAt: status.startedAt } };
}

/** The pieces of a look: a board of the day's suggestion, or closet pieces that are still there. */
async function lookItemIds(personId: string, look: MirrorLook): Promise<string[]> {
  if (look.kind === "today") {
    const row = await db.outfitSuggestion.findFirst({ where: { id: look.suggestionId, personId } });
    const board = (row?.outfits as { itemIds: string[] }[] | undefined)?.[look.index];
    if (!board) throw new TryOnError("That look isn’t here anymore.");
    return board.itemIds;
  }
  const ids = [...new Set((look.itemIds ?? []).filter((id) => typeof id === "string" && id.length < 64))].slice(0, 12);
  if (!ids.length) throw new TryOnError("Pick a piece first.");
  const found = await db.item.findMany({ where: { id: { in: ids }, retiredAt: null }, select: { id: true } });
  if (found.length !== ids.length) throw new TryOnError("One of those pieces isn’t in the closet anymore.");
  return ids;
}

/** Dress a look: the picture when it is quick, else a job to poll with dressingStatusAction. */
export async function dressAction(req: MirrorRequest): Promise<MirrorResult> {
  const me = await requirePerson();
  try {
    const ids = await lookItemIds(req.personId, req.look);
    const view = req.view === "back" ? "back" : "front";
    const on = req.on === "mannequin" ? "mannequin" : "me";
    const key = [me.id, req.personId, on, view, [...ids].sort().join(","), JSON.stringify(req.pick ?? null), req.fresh ? "fresh" : ""].join("|");
    const job = startDressing(key, me.id, (step) =>
      on === "mannequin"
        ? mannequinLook(me, req.personId, ids, req.look.kind, undefined, undefined, req.pick, [], Boolean(req.fresh), { step })
        : tryOnLook(me, req.personId, ids, req.look.kind, undefined, view, req.pick, [], Boolean(req.fresh), { step }));
    return answer(await settled(job, QUICK_MS), job.id);
  } catch (e) {
    return failed(e);
  }
}

/** Where a dressing stands: still running (with its step), done (the picture), or failed (why). */
export async function dressingStatusAction(jobId: string): Promise<MirrorResult> {
  const me = await requirePerson();
  const status = dressingStatus(jobId, me.id);
  if (!status) return { ok: false, error: "That dressing is gone. Try again." };
  return answer(status, jobId);
}

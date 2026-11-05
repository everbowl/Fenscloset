"use server";

import { requirePerson } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { OutfitError } from "@/lib/outfits/engine";
import { dressOnMe, keepTryOn, mirrorEngines, TryOnError, type TryOnView } from "@/lib/tryon";
import { mannequinLook } from "@/lib/tryon/mannequin";
import { getLook, lookGarments, LookError } from "@/lib/looks/service";
import { jobStatus, settled, startJob, type JobStatus } from "@/lib/jobs";
import type { StylingChoice } from "@/lib/tryon/features";

/**
 * The mirror, from any screen: Today (a board of the day's suggestion) or the closet (pieces the person
 * picked, or one piece from its page). Dressing runs in the background (src/lib/jobs.ts): the first
 * call answers with the picture when it is quick, else with a job to poll.
 */

export type MirrorLook = { kind: "today"; suggestionId: string; index: number } | { kind: "closet"; itemIds: string[] } | { kind: "look"; lookId: string };
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
  if (e instanceof TryOnError || e instanceof OutfitError || e instanceof LookError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "The mirror didn’t come back. Try again." };
}

function answer(status: JobStatus<TryOnView>, jobId: string): MirrorResult {
  if (status.state === "done") return { ok: true, tryOn: status.result };
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
  if (look.kind !== "closet") throw new TryOnError("That look isn’t here anymore."); // a saved look is read in dressAction
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
    // A look (B1): its closet pieces now, its store finds fetched inside the job; anything else: the pieces as before.
    const look = req.look.kind === "look" ? await getLook(me, req.look.lookId) : null;
    if (req.look.kind === "look" && !look) throw new TryOnError("That look isn’t here anymore.");
    if (look && look.personId !== req.personId) throw new TryOnError("That look is someone else’s.");
    if (look && !look.pieces.length) throw new TryOnError("Add a piece to the look first.");
    const ids = look ? look.pieces.flatMap((p) => (p.itemId ? [p.itemId] : [])) : await lookItemIds(req.personId, req.look);
    const stamp = look ? `look:${look.id}:${look.pieces.map((p) => p.id).join(",")}` : [...ids].sort().join(",");
    const source = look ? "look" : req.look.kind;
    const view = req.view === "back" ? "back" : "front";
    const on = req.on === "mannequin" ? "mannequin" : "me";
    const rule = on === "me" ? (await mirrorEngines()).rule : "mannequin";
    const key = [me.id, req.personId, on, rule, view, stamp, JSON.stringify(req.pick ?? null), req.fresh ? "fresh" : ""].join("|");
    const job = startJob<TryOnView>(key, me.id, async (step) => {
      const { extras, features } = look ? await lookGarments(look.id) : { extras: [], features: [] };
      if (look && !ids.length && !extras.length) throw new TryOnError("None of these pieces has a picture the mirror can use.");
      return on === "mannequin"
        ? mannequinLook(me, req.personId, ids, source, extras, undefined, req.pick, features, Boolean(req.fresh), { step })
        : dressOnMe(me, req.personId, ids, source, view, req.pick, Boolean(req.fresh), { step }, extras, features);
    });
    return answer(await settled(job, QUICK_MS), job.id);
  } catch (e) {
    return failed(e);
  }
}

/** Where a dressing stands: still running (with its step), done (the picture), or failed (why). */
export async function dressingStatusAction(jobId: string): Promise<MirrorResult> {
  const me = await requirePerson();
  const status = jobStatus<TryOnView>(jobId, me.id);
  if (!status) return { ok: false, error: "That dressing is gone. Try again." };
  return answer(status, jobId);
}

/** Compare: "Keep this one" under a column (G1). The kept engine's picture comes back alone. */
export async function keepTryOnAction(req: { personId: string; tryOnId: string }): Promise<MirrorResult> {
  const me = await requirePerson();
  try { return { ok: true, tryOn: await keepTryOn(me, req.personId, req.tryOnId) }; } catch (e) { return failed(e); }
}

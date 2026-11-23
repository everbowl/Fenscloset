"use client";

import { useCallback, useEffect, useState } from "react";
import type { TryOnView } from "@/lib/tryon";
import type { StylingChoice } from "@/lib/tryon/features";
import type { Engine } from "@/lib/tryon/engines";
import { candidatesFor, EMPTY_WARDROBE, missingSlots, shoesPlaceable, swapIn, type MirrorPiece, type Slot, type Wardrobe } from "@/lib/tryon/complete";
import type { MirrorLook } from "@/app/(app)/mirror/actions";
import { useMirrorJob, type MirrorOn, type MirrorView } from "./mirror-job";

export type { MirrorOn, MirrorView };
export type Mirror = ReturnType<typeof useMirror>;
/**
 * The mirror is asking to complete a look before dressing it: the pieces chosen so far, the slots it offers (a bottom
 * for a top, shoes…) all on one panel, and what has been picked for each (null: go without). One button dresses it.
 */
export type Pending = { itemIds: string[]; on: MirrorOn; ask: Slot[]; picks: Partial<Record<Slot, string | null>> };

function sameLook(a: MirrorLook, b: MirrorLook): boolean {
  if (a.kind === "today" && b.kind === "today") return a.suggestionId === b.suggestionId && a.index === b.index;
  if (a.kind === "closet" && b.kind === "closet") return [...a.itemIds].sort().join() === [...b.itemIds].sort().join();
  if (a.kind === "look" && b.kind === "look") return a.lookId === b.lookId;
  return false;
}

/**
 * The mirror as one screen sees it (Today, the closet, a piece, a look, the full-screen /mirror). The dressing itself
 * lives in the shell (mirror-job.tsx) so it keeps running when the person leaves; this hook adds what is local to a
 * screen: whether its sheet is open, and the "complete the look" panel. With a wardrobe, `begin` first asks to complete
 * the look (a top for a bottom, shoes…) and `swap` changes a piece under the picture; both end in `dress`.
 */
export function useMirror(personId: string, wardrobe: Wardrobe = EMPTY_WARDROBE, engine: Engine = "google") {
  const jobs = useMirrorJob();
  const [open, setOpenState] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const mine = jobs.job && jobs.job.personId === personId ? jobs.job : null;

  const tryOn: TryOnView | null = mine?.status === "done" || (mine?.status === "failed" && mine.tryOn) ? mine.tryOn : null;
  const look: MirrorLook | null = mine?.look ?? null;
  const on: MirrorOn = mine?.on ?? "me";
  const view: MirrorView = mine?.view ?? "front";
  const busy = mine?.status === "running";
  const progress = busy && mine ? { step: mine.step, startedAt: mine.startedAt } : null;
  const error = mine?.error ?? undefined;

  const setOpen = useCallback((v: boolean) => { setOpenState(v); jobs.sheetOpen(v); }, [jobs]);
  useEffect(() => () => { jobs.sheetOpen(false); }, [jobs]);
  const setError = useCallback((e: string | undefined) => jobs.setError(e), [jobs]);

  /** Dress a look. The sheet opens at once and shows progress until the picture arrives; leaving the screen is fine. */
  const dress = useCallback(async (req: { look: MirrorLook; on: MirrorOn; view?: MirrorView; pick?: StylingChoice; fresh?: boolean; pieces?: string }) => {
    setPending(null);
    setOpen(true);
    await jobs.start({ personId, look: req.look, on: req.on, view: req.view, pick: req.pick, fresh: req.fresh, pieces: req.pieces });
  }, [jobs, personId, setOpen]);

  /** A styling chip (pose, tuck, buttons…): the same look, re-styled with this one change. */
  const restyle = useCallback((pick: StylingChoice) => { if (look) void dress({ look, on, view, pick }); }, [dress, look, on, view]);
  /** "Dress again": the saved pictures of this look are thrown away and it is dressed from scratch. */
  const redo = useCallback(() => { if (look) void dress({ look, on, view, fresh: true }); }, [dress, look, on, view]);
  /** On me, from behind, or on the mannequin. */
  const switchTo = useCallback((to: MirrorView | "mannequin") => {
    if (!look) return;
    void dress(to === "mannequin" ? { look, on: "mannequin" } : { look, on: "me", view: to });
  }, [dress, look]);
  /** Open the sheet when this look's picture is already here; otherwise dress it. */
  const show = useCallback((req: { look: MirrorLook; on: MirrorOn; pieces?: string }) => {
    if (tryOn && look && sameLook(look, req.look) && on === req.on && !busy) { setPending(null); setOpen(true); return; }
    void dress(req);
  }, [busy, dress, look, on, setOpen, tryOn]);

  const piecesOf = useCallback((ids: string[]): MirrorPiece[] => ids.map((id) => wardrobe.pieces.find((p) => p.id === id)).filter((p): p is MirrorPiece => Boolean(p)), [wardrobe]);
  const namesOf = useCallback((ids: string[]) => piecesOf(ids).map((p) => p.name).join(" · "), [piecesOf]);

  /**
   * From a piece or the closet's picks: offer to complete the look first, every missing slot on one panel (a bottom for
   * a top, a top for a bottom, shoes when the picture can show them), each optional (Jeff, 20 Nov 2026: one question
   * at a time read as "it asked me only about bottoms"); a one-piece or a full pick goes straight to the mirror.
   */
  const begin = useCallback((req: { look: MirrorLook; on: MirrorOn; pieces?: string }) => {
    if (req.look.kind !== "closet") { show(req); return; }
    const chosen = piecesOf(req.look.itemIds);
    const ask = chosen.length === req.look.itemIds.length ? missingSlots(chosen, wardrobe, { shoesPlaceable: shoesPlaceable(req.on, engine) }) : [];
    if (!ask.length) { show({ ...req, pieces: req.pieces ?? namesOf(req.look.itemIds) }); return; }
    setPending({ itemIds: req.look.itemIds, on: req.on, ask, picks: {} });
    setOpen(true);
  }, [engine, namesOf, piecesOf, setOpen, show, wardrobe]);

  /** A piece for a slot on the panel (a tap on the chosen one takes it off again), or null for none. */
  const pick = useCallback((slot: Slot, piece: MirrorPiece | null) => {
    setPending((p) => (p ? { ...p, picks: { ...p.picks, [slot]: piece && p.picks[slot] !== piece.id ? piece.id : null } } : p));
  }, []);

  /** "See it on me": the chosen pieces and the picks, dressed. */
  const confirm = useCallback(() => {
    if (!pending) return;
    const extra = pending.ask.map((s) => pending.picks[s]).filter((id): id is string => Boolean(id));
    const ids = [...pending.itemIds, ...extra];
    void dress({ look: { kind: "closet", itemIds: ids }, on: pending.on, pieces: namesOf(ids) });
  }, [dress, namesOf, pending]);

  /** Under the picture: another top, another bottom, shoes… the piece swaps in and the look is dressed again. */
  const swap = useCallback((piece: MirrorPiece) => {
    const ids = tryOn?.itemIds ?? (look?.kind === "closet" ? look.itemIds : []);
    if (!ids.length) return;
    const next = swapIn(ids, piece, wardrobe);
    void dress({ look: { kind: "closet", itemIds: next }, on, view, pieces: namesOf(next) });
  }, [dress, look, namesOf, on, tryOn, view, wardrobe]);

  /** Compare: keep one column (G1); the kept picture takes the comparison's place. */
  const keep = useCallback(async (tryOnId: string) => { await jobs.keep(personId, tryOnId); }, [jobs, personId]);

  /** The closet's pieces that could fill a slot of the current look (or the pending one), best first. */
  const options = useCallback((slot: Slot, ids: string[]) => candidatesFor(slot, wardrobe, ids), [wardrobe]);

  /** The screen knows the pieces' names (Today's board): the bar under the header shows them. */
  const describe = jobs.describe;

  return { open, setOpen, tryOn, look, on, view, busy, progress, error, setError, dress, restyle, redo, switchTo, show, begin, pending, pick, confirm, swap, keep, options, piecesOf, wardrobe, engine, describe, jobs };
}

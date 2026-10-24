"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TryOnView } from "@/lib/tryon";
import type { StylingChoice } from "@/lib/tryon/features";
import type { Engine } from "@/lib/tryon/engines";
import { candidatesFor, EMPTY_WARDROBE, missingSlots, shoesPlaceable, swapIn, type MirrorPiece, type Slot, type Wardrobe } from "@/lib/tryon/complete";
import { dressAction, dressingStatusAction, type MirrorLook, type MirrorResult } from "@/app/(app)/mirror/actions";

export type MirrorOn = "me" | "mannequin";
export type MirrorView = "front" | "back";
export type Mirror = ReturnType<typeof useMirror>;
/** The mirror is asking to complete a look before dressing it: what is chosen so far and what it still asks for, in order. */
export type Pending = { itemIds: string[]; on: MirrorOn; ask: Slot[] };

/** How often the screen asks after a dressing that is still running. */
const POLL_MS = 2000;

function sameLook(a: MirrorLook, b: MirrorLook): boolean {
  if (a.kind === "today" && b.kind === "today") return a.suggestionId === b.suggestionId && a.index === b.index;
  if (a.kind === "closet" && b.kind === "closet") return [...a.itemIds].sort().join() === [...b.itemIds].sort().join();
  return false;
}

/**
 * The mirror's state for one screen (Today, the closet, a piece): what is being dressed, its progress
 * while it runs in the background, and the picture when it is done. The sheet opens as soon as a
 * dressing starts, so the person sees "Dressing you · Oxford" instead of a frozen button. With a
 * wardrobe, `begin` first asks to complete the look (a top for a bottom, shoes…) and `swap` changes a
 * piece under the picture; both end in `dress`.
 */
export function useMirror(personId: string, wardrobe: Wardrobe = EMPTY_WARDROBE, engine: Engine = "google") {
  const [open, setOpen] = useState(false);
  const [tryOn, setTryOn] = useState<TryOnView | null>(null);
  const [look, setLook] = useState<MirrorLook | null>(null);
  const [on, setOn] = useState<MirrorOn>("me");
  const [view, setView] = useState<MirrorView>("front");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ step: string; startedAt: number } | null>(null);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<Pending | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { seq.current++; if (timer.current) clearTimeout(timer.current); }, []);

  const settle = useCallback((r: MirrorResult, mine: number) => {
    if (mine !== seq.current) return; // a newer dressing took over
    if (!r.ok) { setBusy(false); setProgress(null); setError(r.error); return; }
    if ("tryOn" in r) { setBusy(false); setProgress(null); setTryOn(r.tryOn); return; }
    setProgress((p) => ({ step: r.pending.step, startedAt: p?.startedAt ?? Date.now() })); // the phone's own clock for the seconds, not the server's
    timer.current = setTimeout(async () => {
      if (mine !== seq.current) return;
      let next: MirrorResult;
      try { next = await dressingStatusAction(r.pending.jobId); } catch { next = r; } // a dropped poll (phone asleep): ask again
      settle(next, mine);
    }, POLL_MS);
  }, []);

  /** Dress a look. The sheet opens at once and shows progress until the picture arrives. */
  const dress = useCallback(async (req: { look: MirrorLook; on: MirrorOn; view?: MirrorView; pick?: StylingChoice; fresh?: boolean }) => {
    const mine = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    const v = req.on === "me" ? (req.view ?? "front") : "front";
    setPending(null);
    setLook(req.look); setOn(req.on); setView(v);
    setBusy(true); setError(undefined); setProgress({ step: "Getting ready…", startedAt: Date.now() }); setOpen(true);
    let r: MirrorResult;
    try { r = await dressAction({ personId, look: req.look, on: req.on, view: v, pick: req.pick, fresh: req.fresh }); }
    catch { r = { ok: false, error: "The mirror didn’t come back. Try again." }; }
    settle(r, mine);
  }, [personId, settle]);

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
  const show = useCallback((req: { look: MirrorLook; on: MirrorOn }) => {
    if (tryOn && look && sameLook(look, req.look) && on === req.on && !busy) { setPending(null); setOpen(true); return; }
    void dress(req);
  }, [busy, dress, look, on, tryOn]);

  const piecesOf = useCallback((ids: string[]): MirrorPiece[] => ids.map((id) => wardrobe.pieces.find((p) => p.id === id)).filter((p): p is MirrorPiece => Boolean(p)), [wardrobe]);

  /**
   * From a piece or the closet's picks: ask to complete the look first (a bottom for a top, a top for a bottom, shoes
   * when the picture can show them), each with a way to decline; a one-piece or a full pick goes straight to the mirror.
   */
  const begin = useCallback((req: { look: MirrorLook; on: MirrorOn }) => {
    if (req.look.kind !== "closet") { show(req); return; }
    const chosen = piecesOf(req.look.itemIds);
    const ask = chosen.length === req.look.itemIds.length ? missingSlots(chosen, wardrobe, { shoesPlaceable: shoesPlaceable(req.on, engine) }) : [];
    if (!ask.length) { show(req); return; }
    if (timer.current) clearTimeout(timer.current);
    seq.current++;
    setBusy(false); setProgress(null); setError(undefined);
    setPending({ itemIds: req.look.itemIds, on: req.on, ask });
    setOpen(true);
  }, [engine, piecesOf, show, wardrobe]);

  /** Answer the current question: a piece, or null to go without. The last answer dresses the look. */
  const choose = useCallback((piece: MirrorPiece | null) => {
    if (!pending) return;
    const itemIds = piece ? [...pending.itemIds, piece.id] : pending.itemIds;
    const ask = pending.ask.slice(1);
    if (ask.length) setPending({ itemIds, on: pending.on, ask });
    else void dress({ look: { kind: "closet", itemIds }, on: pending.on });
  }, [dress, pending]);

  /** Under the picture: another top, another bottom, shoes… the piece swaps in and the look is dressed again. */
  const swap = useCallback((piece: MirrorPiece) => {
    const ids = tryOn?.itemIds ?? (look?.kind === "closet" ? look.itemIds : []);
    if (!ids.length) return;
    void dress({ look: { kind: "closet", itemIds: swapIn(ids, piece, wardrobe) }, on, view });
  }, [dress, look, on, tryOn, view, wardrobe]);

  /** The closet's pieces that could fill a slot of the current look (or the pending one), best first. */
  const options = useCallback((slot: Slot, ids: string[]) => candidatesFor(slot, wardrobe, ids), [wardrobe]);

  return { open, setOpen, tryOn, look, on, view, busy, progress, error, setError, dress, restyle, redo, switchTo, show, begin, pending, choose, swap, options, piecesOf, wardrobe, engine };
}

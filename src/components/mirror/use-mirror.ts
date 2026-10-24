"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TryOnView } from "@/lib/tryon";
import type { StylingChoice } from "@/lib/tryon/features";
import { dressAction, dressingStatusAction, type MirrorLook, type MirrorResult } from "@/app/(app)/mirror/actions";

export type MirrorOn = "me" | "mannequin";
export type MirrorView = "front" | "back";
export type Mirror = ReturnType<typeof useMirror>;

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
 * dressing starts, so the person sees "Dressing you · Oxford" instead of a frozen button.
 */
export function useMirror(personId: string) {
  const [open, setOpen] = useState(false);
  const [tryOn, setTryOn] = useState<TryOnView | null>(null);
  const [look, setLook] = useState<MirrorLook | null>(null);
  const [on, setOn] = useState<MirrorOn>("me");
  const [view, setView] = useState<MirrorView>("front");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ step: string; startedAt: number } | null>(null);
  const [error, setError] = useState<string>();
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
    if (tryOn && look && sameLook(look, req.look) && on === req.on && !busy) { setOpen(true); return; }
    void dress(req);
  }, [busy, dress, look, on, tryOn]);

  return { open, setOpen, tryOn, look, on, view, busy, progress, error, setError, dress, restyle, redo, switchTo, show };
}

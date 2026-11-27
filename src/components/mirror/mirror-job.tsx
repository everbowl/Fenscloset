"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TryOnView } from "@/lib/tryon";
import { dressAction, dressingStatusAction, keepTryOnAction, type MirrorLook, type MirrorRequest, type MirrorResult } from "@/app/(app)/mirror/actions";

/*
 * The mirror's one job, kept at the shell so it outlives the screen that started it (Jeff, 23 Nov 2026: "If mirror takes
 * that long, let me navigate while loading"). A dressing starts from Today, the closet, a piece or a look; the person can
 * go anywhere in the app while it runs. The bar under the header says where it stands and, when it is done, "Your look
 * is ready · See it" opens the full-screen mirror. The job is also written to sessionStorage, so a reload mid-dressing
 * picks the poll back up instead of losing the picture.
 */

export type MirrorOn = "me" | "mannequin";
export type MirrorView = "front" | "back";

export type MirrorJob = {
  personId: string;
  look: MirrorLook;
  on: MirrorOn;
  view: MirrorView;
  /** "Oxford · Chinos": for the bar. The screen that knows the names sets it. */
  pieces: string;
  startedAt: number;
  step: string;
  status: "running" | "done" | "failed";
  /** The server job to poll while running. Null before the first answer, or when the answer was immediate. */
  jobId: string | null;
  tryOn: TryOnView | null;
  error: string | null;
  /** The result has been looked at (a sheet showed it, or /mirror opened): the bar stops announcing it. */
  seen: boolean;
  /** The request, kept so "Try again" can repeat it exactly. */
  request: MirrorRequest;
  /** The request itself did not come back (a dropped connection, or the page left while it was in flight): the next page asks again. */
  cut?: boolean;
};

type Ctx = {
  job: MirrorJob | null;
  start: (req: MirrorRequest & { pieces?: string }) => Promise<void>;
  keep: (personId: string, tryOnId: string) => Promise<void>;
  /** Show a picture that already exists (a recent look on /mirror) without dressing anything. */
  restore: (personId: string, tryOn: TryOnView, look: MirrorLook, pieces: string) => void;
  describe: (pieces: string) => void;
  setError: (error: string | undefined) => void;
  markSeen: () => void;
  dismiss: () => void;
  /** A mirror sheet is showing the job right now: the bar stays out of the way. */
  sheetOpen: (open: boolean) => void;
  isSheetOpen: boolean;
};

const MirrorJobContext = createContext<Ctx | null>(null);

/** How often the shell asks after a dressing that is still running, and when it stops believing one will finish. */
const POLL_MS = 2000;
const DEADLINE_MS = 5 * 60_000;
const STORE_KEY = "fc.mirror.job";
/** The words when the request itself did not come back (a dropped connection; or the page left while it was in flight). */
const LOST = "The mirror didn’t come back. Try again.";

function load(): MirrorJob | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as MirrorJob) : null;
  } catch { return null; }
}
function save(j: MirrorJob | null) {
  try { if (j) sessionStorage.setItem(STORE_KEY, JSON.stringify(j)); else sessionStorage.removeItem(STORE_KEY); } catch { /* private mode */ }
}

export function MirrorJobProvider({ children }: { children: ReactNode }) {
  const [job, setJobState] = useState<MirrorJob | null>(null);
  const [isSheetOpen, setSheetOpen] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setJob = useCallback((next: MirrorJob | null | ((j: MirrorJob | null) => MirrorJob | null)) => {
    // Only a real change is written: a child's effect (markSeen on /mirror) ran before the provider had read storage and used to
    // write null over the stored job.
    setJobState((prev) => { const n = typeof next === "function" ? next(prev) : next; if (n !== prev) save(n); return n; });
  }, []);

  const rejoin = useRef<MirrorJob | null>(null);
  const leaving = useRef(false);
  useEffect(() => {
    const onHide = () => { leaving.current = true; };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);
  useEffect(() => {
    const j = load();
    if (!j) return;
    // Reloaded before the server had answered with a job id, or the leaving page's request was cut: ask again. The job
    // helper joins the dressing already running for the same look (same key), so nothing is dressed twice.
    const cut = j.status === "failed" && j.cut && Date.now() - j.startedAt < 90_000;
    if ((j.status === "running" && !j.jobId) || cut) { const again = { ...j, status: "running" as const, error: null, cut: undefined }; rejoin.current = again; setJobState(again); return; }
    setJobState(j);
  }, []);

  // One answer, whichever call it came from: the picture, a job to keep asking about, or why not.
  const settle = useCallback((r: MirrorResult, mine: number, previous: TryOnView | null) => {
    if (mine !== seq.current) return;
    if (!r.ok) { setJob((j) => (j ? { ...j, status: "failed", error: r.error, tryOn: previous, seen: false } : j)); return; }
    if ("tryOn" in r) { setJob((j) => (j ? { ...j, status: "done", tryOn: r.tryOn, error: null, jobId: null, seen: false, cut: undefined } : j)); return; }
    setJob((j) => (j ? { ...j, jobId: r.pending.jobId, step: r.pending.step } : j));
  }, [setJob]);

  // The poll lives here, not on a screen, so leaving the screen changes nothing.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!job || job.status !== "running" || !job.jobId) return;
    const mine = seq.current;
    const jobId = job.jobId;
    const previous = job.tryOn;
    timer.current = setTimeout(async () => {
      if (mine !== seq.current) return;
      if (Date.now() - job.startedAt > DEADLINE_MS) { setJob((j) => (j ? { ...j, status: "failed", error: "The mirror is taking too long. Try again in a minute.", tryOn: previous, seen: false } : j)); return; }
      let next: MirrorResult;
      try { next = await dressingStatusAction(jobId); } catch { next = { ok: true, pending: { jobId, step: job.step, startedAt: job.startedAt } }; } // a dropped poll (phone asleep): ask again
      settle(next, mine, previous);
    }, POLL_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [job, settle, setJob]);

  useEffect(() => {
    const j = rejoin.current;
    if (!j) return;
    rejoin.current = null;
    void start({ ...j.request, pieces: j.pieces });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, after the restored job is in state
  }, [job]);

  const start = useCallback(async (req: MirrorRequest & { pieces?: string }) => {
    const mine = ++seq.current;
    const view: MirrorView = req.on === "me" ? (req.view ?? "front") : "front";
    const on: MirrorOn = req.on === "mannequin" ? "mannequin" : "me";
    const request: MirrorRequest = { personId: req.personId, look: req.look, on, view, pick: req.pick, fresh: req.fresh };
    let previous: TryOnView | null = null;
    setJob((j) => {
      previous = j && j.personId === req.personId ? j.tryOn : null;
      return { personId: req.personId, look: req.look, on, view, pieces: req.pieces ?? (j && j.personId === req.personId ? j.pieces : ""), startedAt: Date.now(), step: "Getting ready…", status: "running", jobId: null, tryOn: previous, error: null, seen: true, request };
    });
    let r: MirrorResult;
    try { r = await dressAction(request); } catch { if (leaving.current) return; setJob((j) => (j ? { ...j, cut: true } : j)); r = { ok: false, error: LOST }; } // a cut request is marked: the next page asks again
    settle(r, mine, previous);
  }, [setJob, settle]);

  const keep = useCallback(async (personId: string, tryOnId: string) => {
    const mine = ++seq.current;
    setJob((j) => (j ? { ...j, status: "running", step: "Keeping it…", startedAt: Date.now(), jobId: null, error: null } : j));
    let r: MirrorResult;
    try { r = await keepTryOnAction({ personId, tryOnId }); } catch { if (leaving.current) return; r = { ok: false, error: LOST }; }
    if (mine !== seq.current) return;
    setJob((j) => (j ? (r.ok && "tryOn" in r ? { ...j, status: "done", tryOn: r.tryOn, error: null } : { ...j, status: r.ok ? "done" : "failed", error: r.ok ? null : r.error }) : j));
  }, [setJob]);

  const restore = useCallback((personId: string, tryOn: TryOnView, look: MirrorLook, pieces: string) => {
    ++seq.current;
    const view: MirrorView = tryOn.view === "back" ? "back" : "front";
    const on: MirrorOn = tryOn.mannequin ? "mannequin" : "me";
    setJob({ personId, look, on, view, pieces, startedAt: Date.now(), step: "", status: "done", jobId: null, tryOn, error: null, seen: true, request: { personId, look, on, view } });
  }, [setJob]);

  const describe = useCallback((pieces: string) => { setJob((j) => (j && pieces && j.pieces !== pieces ? { ...j, pieces } : j)); }, [setJob]);
  const setError = useCallback((error: string | undefined) => { setJob((j) => (j ? { ...j, error: error ?? null, ...(error ? { status: j.status === "running" ? "failed" : j.status } : {}) } : j)); }, [setJob]);
  const markSeen = useCallback(() => { setJob((j) => (j && !j.seen ? { ...j, seen: true } : j)); }, [setJob]);
  const dismiss = useCallback(() => { ++seq.current; setJob(null); }, [setJob]);
  const sheetOpen = useCallback((open: boolean) => { setSheetOpen(open); if (open) markSeen(); }, [markSeen]);

  const value = useMemo<Ctx>(() => ({ job, start, keep, restore, describe, setError, markSeen, dismiss, sheetOpen, isSheetOpen }), [job, start, keep, restore, describe, setError, markSeen, dismiss, sheetOpen, isSheetOpen]);
  return <MirrorJobContext.Provider value={value}>{children}</MirrorJobContext.Provider>;
}

export function useMirrorJob(): Ctx {
  const ctx = useContext(MirrorJobContext);
  if (!ctx) throw new Error("useMirrorJob needs <MirrorJobProvider> above it (the app layout renders it).");
  return ctx;
}

/**
 * The bar under the header while a look is being dressed, and the "ready" line until the picture is looked at.
 * Hidden on /mirror and while a mirror sheet is showing the same job.
 */
export function MirrorStrip() {
  const { job, isSheetOpen, start, dismiss } = useMirrorJob();
  const pathname = usePathname();
  const [secs, setSecs] = useState(0);
  const running = job?.status === "running";
  useEffect(() => {
    if (!running || !job) return;
    const tick = () => setSecs(Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running, job]);
  if (!job || pathname === "/mirror" || isSheetOpen) return null;
  if (job.status !== "running" && job.seen) return null;
  const pieces = job.pieces ? ` · ${job.pieces}` : "";
  return (
    <div className="sticky top-14 z-20 bg-paper" data-testid="mirror-strip" data-status={job.status} data-error={job.error ?? undefined}>
      <div className="mx-auto max-w-[480px] px-5 pt-2 lg:max-w-[1040px] lg:px-10">
        <div className="flex min-h-11 items-center gap-3 rounded-2xl bg-ink px-4 py-2 text-paper" role="status" aria-live="polite">
          {job.status === "running" ? (
            <>
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-paper motion-reduce:animate-none" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[14px]">{job.on === "mannequin" ? "Dressing the mannequin" : "Dressing you"}{pieces} · {secs}s</span>
              <Link href="/mirror" className="shrink-0 text-[14px] font-semibold underline-offset-4 hover:underline">Open</Link>
            </>
          ) : job.status === "done" ? (
            <>
              <span className="min-w-0 flex-1 truncate text-[14px]">Your look is ready{pieces}</span>
              <Link href="/mirror" className="shrink-0 rounded-full bg-paper px-3 py-1.5 text-[13px] font-semibold text-ink" data-testid="mirror-strip-see">See it</Link>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 text-[14px]">{job.error ?? "The mirror didn’t come back."}</span>
              <button type="button" onClick={() => void start({ ...job.request, pieces: job.pieces })} className="shrink-0 rounded-full bg-paper px-3 py-1.5 text-[13px] font-semibold text-ink">Try again</button>
              <button type="button" onClick={dismiss} aria-label="Dismiss" className="flex size-9 shrink-0 items-center justify-center rounded-full text-paper/80">×</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { wantStatusAction, type WantResult } from "./actions";

/** How often the screen asks after a search that is still running. */
const POLL_MS = 2000;

export type Searching = { step: string; startedAt: number };

/**
 * Searches run in the background (one job per want). A screen starts one with `run(wantId, fn)`, shows
 * `searching[wantId]` (the step and when it started) while it runs, and refreshes the page when it is done.
 */
export function useWantSearch() {
  const router = useRouter();
  const [searching, setSearching] = useState<Record<string, Searching>>({});
  const [error, setError] = useState<string>();
  const seq = useRef<Record<string, number>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [, setNow] = useState(0);

  useEffect(() => {
    const t = timers.current; const s = seq.current;
    return () => { for (const k of Object.keys(s)) s[k]++; for (const k of Object.keys(t)) clearTimeout(t[k]); };
  }, []);
  // the seconds tick while anything runs
  const anyRunning = Object.keys(searching).length > 0;
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  const clear = useCallback((wantId: string) => setSearching((s) => { if (!(wantId in s)) return s; const n = { ...s }; delete n[wantId]; return n; }), []);
  const settle = useCallback((wantId: string, r: WantResult, mine: number) => {
    if (mine !== seq.current[wantId]) return;
    if (!r.ok) { clear(wantId); setError(r.error); router.refresh(); return; }
    if (!r.pending) { clear(wantId); router.refresh(); return; }
    const pending = r.pending;
    setSearching((s) => ({ ...s, [wantId]: { step: pending.step, startedAt: s[wantId]?.startedAt ?? Date.now() } }));
    timers.current[wantId] = setTimeout(async () => {
      if (mine !== seq.current[wantId]) return;
      let next: WantResult;
      try { next = await wantStatusAction(wantId, pending.jobId); } catch { next = r; }
      settle(wantId, next, mine);
    }, POLL_MS);
  }, [clear, router]);

  /** Start (or restart) a search for one want; `fn` is the action that starts it. The id is known up front except when adding: pass "new" and the result's id takes over. */
  const run = useCallback(async (wantId: string, fn: () => Promise<WantResult>) => {
    const mine = (seq.current[wantId] = (seq.current[wantId] ?? 0) + 1);
    if (timers.current[wantId]) clearTimeout(timers.current[wantId]);
    setError(undefined);
    setSearching((s) => ({ ...s, [wantId]: { step: "Getting ready…", startedAt: Date.now() } }));
    let r: WantResult;
    try { r = await fn(); } catch { r = { ok: false, error: "Something went wrong. Try again." }; }
    if (r.ok && r.id !== wantId) {
      // a new want: carry on under its real id
      clear(wantId);
      seq.current[r.id] = (seq.current[r.id] ?? 0) + 1;
      setSearching((s) => ({ ...s, [r.id]: { step: r.pending?.step ?? "Searching the stores…", startedAt: Date.now() } }));
      router.refresh();
      settle(r.id, r, seq.current[r.id]);
      return;
    }
    settle(wantId, r, mine);
  }, [clear, router, settle]);

  const secondsOf = (s: Searching) => Math.max(0, Math.floor((Date.now() - s.startedAt) / 1000));
  return { searching, error, setError, run, secondsOf };
}

/** A search this screen did not start is still running (a row with no first check yet): ask the server again every few seconds until it is done. */
export function useRefreshWhile(waiting: boolean, everyMs = 3000) {
  const router = useRouter();
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [waiting, everyMs, router]);
}

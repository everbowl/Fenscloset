"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * A small removal happens at once and can be taken back for a few seconds (Jeff, 31 Oct 2026, Q1): the thing leaves
 * the screen now; the server hears about it when the strip runs out, or the moment the screen is left. A second
 * removal commits the first. Big removals (a person, a body photo, a whole batch) ask first instead.
 */
export function useUndoable(ms = 5000) {
  const [pending, setPending] = useState<{ text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const job = useRef<{ commit: () => void; revert?: () => void } | null>(null);
  const flush = useRef(() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } const j = job.current; job.current = null; j?.commit(); });
  useEffect(() => { const f = flush.current; return () => f(); }, []); // leaving the screen commits
  function start(text: string, commit: () => void, revert?: () => void) {
    flush.current();
    job.current = { commit, revert }; setPending({ text });
    timer.current = setTimeout(() => { timer.current = null; setPending(null); const j = job.current; job.current = null; j?.commit(); }, ms);
  }
  function undo() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; setPending(null);
    const j = job.current; job.current = null; j?.revert?.();
  }
  return { pending, start, undo };
}

/** "Removed · Undo": the strip under the thing that just went. */
export function UndoStrip({ text, onUndo, testId = "undo-strip", className }: { text: string; onUndo: () => void; testId?: string; className?: string }) {
  return (
    <div className={cn("flex min-h-[50px] items-center justify-between gap-3 border-y border-ink py-2", className)} role="status" data-testid={testId}>
      <span className="mono truncate">{text}</span>
      <button type="button" onClick={onUndo} className="pill pill-sm shrink-0" data-testid={`${testId}-undo`}>Undo</button>
    </div>
  );
}

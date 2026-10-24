"use client";

import { useActionState } from "react";
import { untidyNowAction, type UntidyState } from "./actions";

/**
 * Tidy and Smooth are gone (Jeff, 19 Oct 2026); the pieces they touched get a fresh cutout from the original photo,
 * one remove.bg credit each. Shown only while some still wait (the server also tries again every hour on its own).
 * Always mounted: a server action's refresh re-renders the page with the new count, and the row must keep its result.
 */
export function UntidyPhotos({ pending }: { pending: number }) {
  const [state, action, busy] = useActionState<UntidyState, FormData>(untidyNowAction, {});
  const word = (n: number) => `${n} piece${n === 1 ? "" : "s"}`;
  const finished = state.done?.done === true;
  const left = state.done ? state.done.failed : pending;
  if (!pending && !state.done) return null;
  return (
    <form action={action} className="border-t border-ink pt-5" data-testid="untidy-photos">
      <p className="text-[14px] leading-snug text-graphite">
        {finished ? <>Every piece has its fresh cutout again.</> : <><span className="font-medium text-ink">{word(left)}</span> still {left === 1 ? "shows" : "show"} the AI-edited picture Tidy or Smooth made. Each gets a fresh cutout from its original photo (one remove.bg credit each). The site tries again every hour on its own; this does it now.</>}
      </p>
      {finished ? null : <button type="submit" disabled={busy} className="pill mt-4 h-[50px] w-full" data-testid="untidy-now">{busy ? "Re-cutting…" : `Re-cut ${word(left)} now`}</button>}
      {state.done ? (
        <p className="mono mt-3 text-graphite" data-testid="untidy-result">
          {state.done.recut} re-cut{state.done.skipped ? ` · ${state.done.skipped} had no original` : ""}{state.done.failed ? ` · ${state.done.failed} still waiting` : ""}{state.done.done ? " · all done" : ""}
          {state.done.lastError ? <><br />— {state.done.lastError}{/insufficient_credits/.test(state.done.lastError) ? <> · <a href="https://www.remove.bg/dashboard#credits" target="_blank" rel="noreferrer" className="underline">buy credits</a></> : null}</> : null}
        </p>
      ) : null}
      {state.error ? <p className="mono mt-3 text-ink">— {state.error}</p> : null}
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { refitPhotosAction, type RefitState } from "./actions";

/** Pieces added before cutouts were trimmed sit small in their boxes; one tap refits them all. */
export function RefitPhotos() {
  const [state, action, pending] = useActionState<RefitState, FormData>(refitPhotosAction, {});
  return (
    <form action={action} className="border-t border-ink pt-5">
      <p className="text-[14px] leading-snug text-graphite">Trims the empty margin around every piece so it fills its box. Pieces already fitted are left alone.</p>
      <button type="submit" disabled={pending} className="pill mt-4 h-[50px] w-full" data-testid="refit-photos">{pending ? "Refitting…" : "Refit all photos"}</button>
      {state.done ? <p className="mono mt-3 text-graphite" data-testid="refit-result">{state.done.refit} refit · {state.done.checked - state.done.refit} already fit</p> : null}
      {state.error ? <p className="mono mt-3 text-ink">— {state.error}</p> : null}
    </form>
  );
}

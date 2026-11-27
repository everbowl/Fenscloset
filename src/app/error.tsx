"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";
import { useEffect, useState } from "react";
import { looksLikeStaleBuild } from "@/components/ui/stale-build";

/** The last net, outside the shell (the layout itself failed). After a deploy the one way on is Reload (see (app)/error.tsx). */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const stale = unstable_isUnrecognizedActionError(error) || looksLikeStaleBuild(error);
  const [reloading, setReloading] = useState(false);
  const reload = () => { setReloading(true); window.location.reload(); };
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-start justify-center gap-4 px-6" data-stale={stale || undefined}>
      <p className="caption">{stale ? "New version" : "Something went wrong"}</p>
      <h1 className="title">{stale ? "The app was updated" : "Something slipped"}</h1>
      <p className="note max-w-sm">{stale ? "Reload to pick up the new version. Nothing you saved is lost." : "The page didn’t load right. Nothing you saved is lost."}</p>
      <div className="mt-2 flex gap-2">
        {stale
          ? <button type="button" onClick={reload} disabled={reloading} className="pill pill-solid h-[50px] px-6" data-testid="app-error-reload">{reloading ? "Reloading…" : "Reload"}</button>
          : <button type="button" onClick={reset} className="pill pill-solid h-[50px] px-6">Try again</button>}
        <a href="/today" className="pill h-[50px] px-6">Go to Today</a>
      </div>
    </main>
  );
}

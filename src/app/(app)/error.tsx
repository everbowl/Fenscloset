"use client";

import Link from "next/link";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { useEffect, useState } from "react";
import { looksLikeStaleBuild } from "@/components/ui/stale-build";

/**
 * Something failed inside the shell: say so in the app's voice, offer the ways on. A page left open across a deploy gets
 * one way only, Reload, because Try again would call the build that is gone (the owner, 23 Nov 2026: no dead buttons after a
 * deploy). The raw error goes to the console, never to the family.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const stale = unstable_isUnrecognizedActionError(error) || looksLikeStaleBuild(error);
  const [reloading, setReloading] = useState(false);
  const reload = () => { setReloading(true); window.location.reload(); };
  return (
    <div className="flex flex-col items-start gap-4 pt-6" data-testid="app-error" data-stale={stale || undefined}>
      <p className="caption">{stale ? "New version" : "Something went wrong"}</p>
      <h1 className="title">{stale ? "The app was updated" : "Something slipped"}</h1>
      <p className="note max-w-sm">{stale ? "Reload to pick up the new version. Nothing you saved is lost." : "The page didn’t load right. Nothing you saved is lost."}</p>
      <div className="mt-2 flex gap-2">
        {stale
          ? <button type="button" onClick={reload} disabled={reloading} className="pill pill-solid h-[50px] px-6" data-testid="app-error-reload">{reloading ? "Reloading…" : "Reload"}</button>
          : <button type="button" onClick={reset} className="pill pill-solid h-[50px] px-6">Try again</button>}
        {/* A plain link when stale: the client router is from the old build too. */}
        {stale ? <a href="/today" className="pill h-[50px] px-6">Go to Today</a> : <Link href="/today" className="pill h-[50px] px-6">Go to Today</Link>}
      </div>
    </div>
  );
}

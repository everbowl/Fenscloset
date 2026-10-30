"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Something failed inside the shell: say so in the app's voice, offer the two ways on. The raw error goes to the console, never to the family. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="flex flex-col items-start gap-4 pt-6" data-testid="app-error">
      <p className="mono text-graphite">Something went wrong</p>
      <h1 className="serif text-[44px] leading-none">Something <em>slipped</em></h1>
      <p className="max-w-sm text-[15px] leading-snug text-graphite">The page didn’t load right. Nothing you saved is lost.</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={reset} className="pill pill-solid h-[50px] px-6">Try again</button>
        <Link href="/today" className="pill h-[50px] px-6">Go to Today</Link>
      </div>
    </div>
  );
}

"use client";

import { useEffect } from "react";

/** The last net, outside the shell (the layout itself failed). */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-start justify-center gap-4 px-6">
      <p className="mono text-graphite">Something went wrong</p>
      <h1 className="serif text-[44px] leading-none">Something <em>slipped</em></h1>
      <p className="max-w-sm text-[15px] leading-snug text-graphite">The page didn’t load right. Nothing you saved is lost.</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={reset} className="pill pill-solid h-[50px] px-6">Try again</button>
        <a href="/today" className="pill h-[50px] px-6">Go to Today</a>
      </div>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";

/** The clock, re-read every `everyMs`: screens that say "Taking long" after a minute need to notice the minute passing. */
export function useNow(everyMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

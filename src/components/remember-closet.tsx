"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { rememberCloset, rememberClosetScroll, takeClosetRestore } from "@/lib/closet-memory";

/** Lives on the closet grid: remembers the view and the scroll, and scrolls back after a return from a piece. */
export function RememberCloset() {
  const pathname = usePathname();
  const search = useSearchParams();
  const url = `${pathname}${search.toString() ? `?${search}` : ""}`;
  useEffect(() => { rememberCloset(url); }, [url]);
  useEffect(() => {
    const y = takeClosetRestore();
    if (y !== null) requestAnimationFrame(() => window.scrollTo({ top: y }));
    let frame = 0;
    const onScroll = () => { if (frame) return; frame = requestAnimationFrame(() => { frame = 0; rememberClosetScroll(window.scrollY); }); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (frame) cancelAnimationFrame(frame); };
  }, []);
  return null;
}

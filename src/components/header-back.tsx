"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { lastClosetUrl, markClosetRestore } from "@/lib/closet-memory";
import { parentOf as parentOfTrail, type Crumb } from "@/lib/crumbs";

/**
 * The back control lives in the sticky header (the owner, 19 Oct 2026: "back should never leave the
 * header"). It shows on any page that has a parent, and goes to that parent, never off the site.
 * From a piece it goes back to the closet view the person left (tab, search, sort, filters, scroll).
 */
export type Parent = Crumb;
/** One level up the trail (src/lib/crumbs.ts); the row under the header and this control never disagree. */
export const parentOf = parentOfTrail;

export function HeaderBack() {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams();
  const parent = parentOf(pathname, search);
  // Read after mount: session storage is not there on the server, and the first paint must match.
  const [closetHref, setClosetHref] = useState<string | null>(null);
  useEffect(() => { setClosetHref(lastClosetUrl()); }, [pathname]);
  if (!parent) return null;
  const href = parent.closet && closetHref ? closetHref : parent.href;
  return (
    <Link href={href} aria-label={`Back to ${parent.label}`} onClick={() => { if (parent.closet) markClosetRestore(); }} className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center text-ink active:text-graphite" data-testid="header-back">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
    </Link>
  );
}

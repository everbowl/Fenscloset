"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { lastClosetUrl, markClosetRestore } from "@/lib/closet-memory";

/**
 * The back control lives in the sticky header (Jeff, 19 Oct 2026: "back should never leave the
 * header"). It shows on any page that has a parent, and goes to that parent, never off the site.
 * From a piece it goes back to the closet view the person left (tab, search, sort, filters, scroll).
 */
export type Parent = { href: string; label: string; /** Back lands on the closet grid: use the remembered view. */ closet?: boolean };

export function parentOf(pathname: string, search?: URLSearchParams | null): Parent | null {
  const forPerson = search?.get("for");
  const withFor = (href: string) => (forPerson ? `${href}?for=${encodeURIComponent(forPerson)}` : href);
  const m = (re: RegExp) => pathname.match(re);
  let g: RegExpMatchArray | null;
  if ((g = m(/^\/closet\/([^/]+)\/go-with$/))) return { href: `/closet/${g[1]}`, label: "the piece" };
  if (pathname === "/closet/clean-out") return search?.get("from") === "today" ? { href: "/today", label: "Today" } : { href: "/closet", label: "Closet", closet: true };
  if (m(/^\/closet\/.+/)) return { href: "/closet", label: "Closet", closet: true };
  if (m(/^\/profile\/.+/)) return { href: "/profile", label: "Profile" };
  if (pathname === "/profile") return { href: "/today", label: "Today" };
  if (m(/^\/today\/.+/)) return { href: "/today", label: "Today" };
  if (m(/^\/shop\/looking-for\/.+/)) return { href: withFor("/shop/looking-for"), label: "Looking for" };
  if (m(/^\/shop\/.+/)) return { href: withFor("/shop"), label: "Shop" };
  if (m(/^\/fits\/.+/)) return { href: "/fits", label: "Fits" };
  if (m(/^\/add\/.+/)) return { href: "/add", label: "Add" };
  if (m(/^\/admin\/lists\/.+/)) return { href: "/admin/lists", label: "Lists" };
  if (m(/^\/admin\/people\/.+/)) return { href: "/admin/people", label: "People" };
  if (m(/^\/admin\/.+/)) return { href: "/today", label: "Today" };
  if (m(/^\/help\/.+/)) return { href: "/help", label: "Help" };
  if (pathname === "/help") return { href: "/today", label: "Today" };
  if (pathname === "/change-password") return { href: "/today", label: "Today" };
  return null;
}

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
    <Link href={href} aria-label={`Back to ${parent.label}`} onClick={() => { if (parent.closet) markClosetRestore(); }} className="-ml-1 flex h-11 w-10 shrink-0 items-center justify-center text-ink active:text-graphite" data-testid="header-back">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
    </Link>
  );
}

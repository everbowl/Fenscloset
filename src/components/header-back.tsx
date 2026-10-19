"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The back control lives in the sticky header (Jeff, 19 Oct 2026: "back should never leave the
 * header"). It shows on any page that has a parent, and goes to that parent, never off the site.
 */
const PARENTS: [RegExp, string, string][] = [
  [/^\/profile\/.+/, "/profile", "Profile"],
  [/^\/profile$/, "/today", "Today"],
  [/^\/closet\/.+/, "/closet", "Closet"],
  [/^\/today\/.+/, "/today", "Today"],
  [/^\/shop\/.+/, "/shop", "Shop"],
  [/^\/fits\/.+/, "/fits", "Fits"],
  [/^\/admin\/lists\/.+/, "/admin/lists", "Lists"],
  [/^\/admin\/people\/.+/, "/admin/people", "People"],
  [/^\/admin\/.+/, "/today", "Today"],
  [/^\/help\/.+/, "/help", "Help"],
  [/^\/help$/, "/today", "Today"],
  [/^\/change-password$/, "/today", "Today"],
];

export function parentOf(pathname: string): { href: string; label: string } | null {
  for (const [re, href, label] of PARENTS) if (re.test(pathname)) return { href, label };
  return null;
}

export function HeaderBack() {
  const parent = parentOf(usePathname() ?? "/");
  if (!parent) return null;
  return (
    <Link href={parent.href} aria-label={`Back to ${parent.label}`} className="-ml-1 flex h-11 w-10 shrink-0 items-center justify-center text-ink" data-testid="header-back">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
    </Link>
  );
}

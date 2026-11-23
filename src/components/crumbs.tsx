"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { trailFor } from "@/lib/crumbs";
import { lastClosetUrl, markClosetRestore } from "@/lib/closet-memory";

/*
 * The breadcrumb row under the header (Jeff, 23 Nov 2026): every level back is a tap, the current page is plain text,
 * and a flow's next step sits at the right as an arrow. Tab roots show no row: the tab bar is the location there.
 * A page with a real name (a piece, a person, a want) renders <CrumbLabel label="Blue linen shirt" /> and the row
 * swaps the placeholder for it.
 */

// A tiny store keyed by pathname: pages set their own name, the row reads it. No context needed, so it works from
// server components (which render <CrumbLabel>, a client component).
const labels = new Map<string, string>();
const listeners = new Set<() => void>();
function setLabel(pathname: string, label: string | null) {
  if (label) labels.set(pathname, label); else labels.delete(pathname);
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
const never = () => () => {};

/** Rendered by a page whose last crumb has a real name. */
export function CrumbLabel({ label }: { label: string }) {
  const pathname = usePathname() ?? "/";
  useEffect(() => { setLabel(pathname, label); return () => setLabel(pathname, null); }, [pathname, label]);
  return null;
}

export function Crumbs() {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams();
  // Both reads go through useSyncExternalStore with a server snapshot: the page's <CrumbLabel> effect and the remembered
  // closet view can both land before this row hydrates (it sits in its own Suspense boundary), and reading them straight
  // made the first paint say "Old parka" where the server had said "Piece" (React #418). The hydration render now matches
  // the server, and the real name follows one frame later.
  const named = useSyncExternalStore(subscribe, () => labels.get(pathname) ?? null, () => null);
  const closetBack = useSyncExternalStore(never, () => lastClosetUrl(), () => null);
  const { crumbs, next } = trailFor(pathname, search);
  if (crumbs.length < 2) return null;
  const last = crumbs[crumbs.length - 1];
  const lastLabel = named ?? last.label;
  return (
    <nav aria-label="Where you are" className="mb-3 flex items-center gap-1 text-[13px] leading-none" data-testid="crumbs">
      <ol className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {crumbs.slice(0, -1).map((c) => {
          const href = c.closet ? (closetBack ?? c.href) : c.href;
          return (
            <li key={c.href} className="flex shrink-0 items-center gap-1">
              <Link href={href} onClick={() => { if (c.closet) markClosetRestore(); }} className="tap rounded-md px-1 py-1.5 text-graphite hover:text-ink">{c.label}</Link>
              <span aria-hidden className="text-line">/</span>
            </li>
          );
        })}
        <li className="min-w-0 truncate px-1 py-1.5 font-medium text-ink" aria-current="page">{lastLabel}</li>
      </ol>
      {next ? <Link href={next.href} className="pill pill-sm pill-quiet shrink-0" data-testid="crumb-next">{next.label} →</Link> : null}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/* Five-slot bar from the mockups: TODAY · CLOSET · [+] · SHOP · FITS. 76px, black top rule, mono 10px. */
const tabs = [
  { href: "/today", label: "Today" },
  { href: "/closet", label: "Closet" },
  { href: "/add", label: "Add clothes", plus: true },
  { href: "/shop", label: "Shop" },
  { href: "/fits", label: "Fits" },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-ink bg-paper">
      <div className="mx-auto grid h-[76px] max-w-[480px] grid-cols-5 items-center px-2 pb-[10px]">
        {tabs.map(({ href, label, plus }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          if (plus) {
            return (
              <Link key={href} href={href} aria-label={label} className={cn("flex size-[46px] items-center justify-center justify-self-center bg-ink text-paper", active && "ring-2 ring-ink ring-offset-2")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 4v16M4 12h16" /></svg>
              </Link>
            );
          }
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={cn("mono justify-self-center px-1 py-3.5", active ? "border-b-[1.5px] border-ink text-ink" : "text-graphite")}>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

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
/* Phones keep the drawn order with + in the middle; on desktop the four tabs sit together and + goes to the far right. */

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-ink bg-paper lg:static lg:border-t-0 lg:border-b lg:border-line">
      <div className="mx-auto grid h-[76px] max-w-[480px] grid-cols-5 items-center px-2 pb-[10px] lg:flex lg:h-12 lg:max-w-[1040px] lg:items-stretch lg:gap-8 lg:px-10 lg:pb-0">
        {tabs.map(({ href, label, plus }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          if (plus) {
            return (
              <Link key={href} href={href} aria-label={label} className={cn("flex size-[46px] items-center justify-center justify-self-center bg-ink text-paper active:bg-graphite lg:order-last lg:ml-auto lg:h-auto lg:w-auto lg:gap-2 lg:bg-transparent lg:px-0 lg:text-ink", active && "ring-2 ring-ink ring-offset-2 lg:ring-0")}>
                <span className="flex size-[46px] items-center justify-center lg:size-8 lg:bg-ink lg:text-paper"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 4v16M4 12h16" /></svg></span>
                <span className={cn("mono hidden lg:inline", active ? "text-ink" : "text-graphite")}>Add clothes</span>
              </Link>
            );
          }
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={cn("mono flex h-full w-full items-center justify-center self-stretch text-center active:text-ink lg:w-auto lg:px-0", active ? "text-ink" : "text-graphite")}>
              <span className={cn("py-1", active && "border-b-[1.5px] border-ink")}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sun, Shirt, Plus, ShoppingBag, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";

const tabs = [
  { href: "/today", label: "Today", icon: Sun },
  { href: "/closet", label: "Closet", icon: Shirt },
  { href: "/add", label: "Add", icon: Plus, primary: true },
  { href: "/shop", label: "Shop", icon: ShoppingBag },
  { href: "/profile", label: "Profile", icon: UserRound },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur md:inset-y-0 md:left-0 md:right-auto md:w-56 md:border-r md:border-t-0">
      <div className="md:px-4 md:pt-6">
        <p className="hidden px-2 pb-4 text-lg font-semibold tracking-tight md:block">Fen&apos;s Closet</p>
        <ul className="grid grid-cols-5 md:flex md:flex-col md:gap-1">
          {tabs.map(({ href, label, icon: Icon, primary }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium md:h-11 md:flex-row md:justify-start md:gap-3 md:rounded-xl md:px-3 md:text-sm",
                    active ? "text-accent md:bg-amber-50" : "text-muted hover:text-foreground md:hover:bg-stone-100",
                  )}
                >
                  {primary ? (
                    <span className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground shadow md:size-6">
                      <Icon className="size-5 md:size-4" />
                    </span>
                  ) : (
                    <Icon className="size-6 md:size-5" />
                  )}
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

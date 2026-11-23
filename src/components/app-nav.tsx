"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, Plus, Shirt, ShoppingBag, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { LinkPending } from "@/components/link-pending";

/* The tab bar (docs/redesign-2026-11-23.md): Today · Closet · + · Shop · Fits, icons with labels, the + a black circle. */
const tabs = [
  { href: "/today", label: "Today", Icon: Sun },
  { href: "/closet", label: "Closet", Icon: Shirt },
  { href: "/add", label: "Add clothes", plus: true, Icon: Plus },
  { href: "/shop", label: "Shop", Icon: ShoppingBag },
  { href: "/fits", label: "Fits", Icon: CalendarCheck },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 backdrop-blur lg:static lg:border-t-0 lg:border-b lg:bg-paper lg:backdrop-blur-none">
      <div className="mx-auto grid h-[76px] max-w-[480px] grid-cols-5 items-center px-2 lg:flex lg:h-12 lg:max-w-[1040px] lg:items-stretch lg:gap-8 lg:px-10">
        {tabs.map(({ href, label, plus, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          if (plus) {
            return (
              <Link key={href} href={href} aria-label={label} className="flex items-center justify-center justify-self-center lg:order-last lg:ml-auto">
                <span className="flex size-[52px] items-center justify-center rounded-full bg-ink text-paper shadow-[0_6px_16px_rgba(0,0,0,0.18)] transition-transform active:scale-95 lg:size-9 lg:shadow-none"><Icon className="size-6 lg:size-5" strokeWidth={2.2} /></span>
                <span className={cn("ml-2 hidden text-[14px] font-medium lg:inline", active ? "text-ink" : "text-graphite")}>Add clothes</span>
              </Link>
            );
          }
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={cn("flex h-full w-full flex-col items-center justify-center gap-1 self-stretch active:opacity-70 lg:w-auto lg:flex-row lg:gap-2 lg:px-0", active ? "text-ink" : "text-graphite")}>
              <Icon className="size-[22px] lg:size-[18px]" strokeWidth={active ? 2.2 : 1.8} />
              <LinkPending className={cn("text-[11px] font-medium lg:text-[14px]", active && "lg:border-b-2 lg:border-ink")}>{label}</LinkPending>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

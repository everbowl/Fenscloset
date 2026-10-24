"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export type ViewOption = { key: string; label: string };

/**
 * Header person switcher (`JEFF ⌄` / `FAMILY ⌄`): the people the viewer can browse plus FAMILY,
 * then the person's own links (profile, password, admin tools, log out).
 */
export function PersonMenu({ views, current, isAdmin, logout, setView }: {
  views: ViewOption[]; current: string; isAdmin: boolean; logout: () => Promise<void>; setView: (key: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const label = views.find((v) => v.key === current)?.label ?? views[0]?.label ?? "";
  const Row = ({ href, label }: { href: string; label: string }) => (
    <Link href={href} onClick={() => setOpen(false)} className="flex h-12 items-center justify-between border-b border-line text-[15px]">
      {label}<span className="mono text-graphite">→</span>
    </Link>
  );
  function choose(key: string) {
    start(async () => { await setView(key); setOpen(false); router.refresh(); });
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`${label} menu`} className="mono mono-11 flex h-11 items-center gap-1.5 px-2">
        {label} <ChevronDown className="size-2.5" strokeWidth={2.5} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Viewing">
        <div className="flex flex-col" role="listbox" aria-label="Closet to view">
          {views.map((v) => (
            <button key={v.key} type="button" role="option" aria-selected={v.key === current} disabled={pending} onClick={() => choose(v.key)} className="flex h-12 items-center justify-between border-b border-line text-[15px]">
              <span>{v.label}{v.key === "family" ? " closet" : ""}</span>
              <span className={cn("mono", v.key === current ? "text-ink" : "text-transparent")}>{v.key === current ? "✓" : "·"}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col pt-5">
          <p className="mono pb-2 text-graphite">You</p>
          <Row href="/profile" label="Profile" />
          <Row href="/change-password" label="Change password" />
          <Row href="/help" label="Help · how to use it" />
          {isAdmin ? (
            <>
              <p className="mono pt-5 pb-2 text-graphite">Admin</p>
              <Row href="/admin/people" label="People" />
              <Row href="/admin/lists" label="Lists" />
              <Row href="/admin/rules" label="Rules" />
            </>
          ) : null}
        </div>
        <form action={logout} className="pt-6">
          <Button type="submit" variant="secondary" className="w-full">Log out</Button>
        </form>
      </Sheet>
    </>
  );
}

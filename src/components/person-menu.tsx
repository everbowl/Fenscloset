"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

/** "JEFF ⌄" in the header: opens profile, admin tools (admins only), and log out. */
export function PersonMenu({ name, isAdmin, logout }: { name: string; isAdmin: boolean; logout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const first = name.split(" ")[0];
  const Row = ({ href, label }: { href: string; label: string }) => (
    <Link href={href} onClick={() => setOpen(false)} className="flex h-12 items-center justify-between border-b border-line text-[15px]">
      {label}<span className="mono text-graphite">→</span>
    </Link>
  );
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`${first} menu`} className="mono mono-11 flex h-11 items-center gap-1.5 px-2">
        {first} <ChevronDown className="size-2.5" strokeWidth={2.5} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={first}>
        <div className="flex flex-col">
          <Row href="/profile" label="Profile" />
          <Row href="/change-password" label="Change password" />
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

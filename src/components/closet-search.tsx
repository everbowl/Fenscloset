"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { HeaderAction } from "@/components/header-action";
import { Input } from "@/components/ui/input";

/** Search icon in the header; opens an underline field under the title. Filters by name or brand. */
export function ClosetSearch({ basePath }: { basePath: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get("q") ?? "";
  const [open, setOpen] = useState(Boolean(initial));
  const [q, setQ] = useState(initial);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams(params.toString());
    if (q.trim()) p.set("q", q.trim()); else p.delete("q");
    router.push(`${basePath}${p.toString() ? `?${p}` : ""}`);
  }
  return (
    <>
      <HeaderAction>
        <button type="button" aria-label="Search" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex size-11 items-center justify-center text-ink">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8" /></svg>
        </button>
      </HeaderAction>
      {open ? (
        <form onSubmit={submit} className="mb-4">
          <label htmlFor="closet-search" className="mono text-graphite">Search</label>
          <Input id="closet-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or brand" autoFocus enterKeyHint="search" />
        </form>
      ) : null}
    </>
  );
}

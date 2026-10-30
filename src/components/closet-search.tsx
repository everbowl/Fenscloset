"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HeaderAction } from "@/components/header-action";
import { Input } from "@/components/ui/input";

/** Search icon in the header; opens an underline field under the title. Filters by name or brand as you type (after a short pause), × clears. */
export function ClosetSearch({ basePath }: { basePath: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get("q") ?? "";
  const [open, setOpen] = useState(Boolean(initial));
  const [q, setQ] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paramsString = params.toString();
  function go(term: string) {
    const p = new URLSearchParams(paramsString);
    if (term.trim()) p.set("q", term.trim()); else p.delete("q");
    router.replace(`${basePath}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  }
  function change(term: string) {
    setQ(term);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go(term), 300);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    go(q);
  }
  function clear() {
    if (timer.current) clearTimeout(timer.current);
    setQ(""); go("");
  }
  return (
    <>
      <HeaderAction>
        <button type="button" aria-label="Search" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex size-11 items-center justify-center text-ink">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8" /></svg>
        </button>
      </HeaderAction>
      {open ? (
        <form onSubmit={submit} className="mb-4" role="search">
          <label htmlFor="closet-search" className="mono text-graphite">Search</label>
          <div className="relative">
            <Input id="closet-search" type="search" value={q} onChange={(e) => change(e.target.value)} placeholder="Name or brand" autoFocus enterKeyHint="search" className="h-11 pr-11 [&::-webkit-search-cancel-button]:hidden" data-testid="closet-search" />
            {q ? <button type="button" onClick={clear} aria-label="Clear search" className="absolute right-0 top-0 flex size-11 items-center justify-center text-ink" data-testid="closet-search-clear"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M5 5l14 14M19 5 5 19" /></svg></button> : null}
          </div>
        </form>
      ) : null}
    </>
  );
}

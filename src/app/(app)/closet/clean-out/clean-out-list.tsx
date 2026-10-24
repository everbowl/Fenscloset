"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { cleanOutAction } from "./actions";

type Row = { id: string; name: string; thumbKey: string | null; categoryName: string | null; lastWornAt: string | null; createdAt: string; wearCount: number };

const month = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" }).toUpperCase();

export function CleanOutList({ items, canDecide }: { items: Row[]; canDecide: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  function decide(id: string, d: "keep" | "donate" | "sell") {
    setBusy(id); setError(undefined);
    start(async () => { const r = await cleanOutAction(id, d); setBusy(null); if (!r.ok) setError(r.error); router.refresh(); });
  }
  if (!items.length) return <p className="serif text-[21px] italic leading-[1.3]">Everything in this closet has been worn recently. Nice.</p>;
  return (
    <div>
      {error ? <Banner tone="danger" title={error} className="mb-3" /> : null}
      <div className="flex flex-col">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-3 border-b border-line py-2.5" data-testid="clean-out-row">
            <Link href={`/closet/${it.id}`} className="size-12 shrink-0 bg-bone">{it.thumbKey ? <img src={`/api/photo/${it.thumbKey}`} alt="" className="size-full object-cover" /> : null}</Link>
            <div className="min-w-0 flex-1">
              <Link href={`/closet/${it.id}`} className="block truncate text-[14px] font-medium">{it.name}</Link>
              <p className="mono truncate text-graphite">{[it.categoryName, it.lastWornAt ? `Not worn since ${month(it.lastWornAt)}` : `Never worn · added ${month(it.createdAt)}`].filter(Boolean).join(" · ")}</p>
            </div>
            {canDecide ? (
              <div className="mono mono-11 flex shrink-0 gap-3">
                {(["keep", "donate", "sell"] as const).map((d) => <button key={d} type="button" disabled={busy === it.id} onClick={() => decide(it.id, d)} className="uppercase disabled:text-graphite" data-testid={`${d}-${it.id}`}>{d}</button>)}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mono mt-4 text-graphite">Keep hides a piece from this list for 3 months. Donate and Sell retire it from the closet; wear history stays.</p>
    </div>
  );
}

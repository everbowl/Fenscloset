"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { cleanOutAction, unretireAction } from "./actions";

type Row = { id: string; name: string; thumbKey: string | null; categoryName: string | null; lastWornAt: string | null; createdAt: string; wearCount: number };
type Decision = "keep" | "donate" | "sell";
const WORD: Record<Decision, string> = { keep: "Kept · back in 3 months", donate: "Donated", sell: "Set aside to sell" };

const month = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" }).toUpperCase();

/** Each piece not worn in a while, with Keep / Donate / Sell as pills. Donate and Sell can be undone for a few seconds right here. */
export function CleanOutList({ items, canDecide }: { items: Row[]; canDecide: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [gone, setGone] = useState<string[]>([]);
  const [last, setLast] = useState<{ item: Row; decision: Decision } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function decide(it: Row, d: Decision) {
    setBusy(it.id); setError(undefined);
    start(async () => {
      const r = await cleanOutAction(it.id, d);
      setBusy(null);
      if (!r.ok) { setError(r.error); return; }
      setGone((g) => [...g, it.id]);
      setLast({ item: it, decision: d });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { setLast(null); router.refresh(); }, 6000);
    });
  }
  function undo() {
    if (!last) return;
    const { item } = last;
    if (timer.current) clearTimeout(timer.current);
    setLast(null); setBusy(item.id);
    start(async () => {
      const r = await unretireAction(item.id);
      setBusy(null);
      if (!r.ok) { setError(r.error); return; }
      setGone((g) => g.filter((id) => id !== item.id));
    });
  }

  const shown = items.filter((it) => !gone.includes(it.id));
  // The action revalidates the page, so the list can come back empty while the strip is still up: the strip stays, with Undo, until its timer runs out.
  const empty = !items.length;
  return (
    <div>
      {error ? <Banner tone="danger" title={error} className="mb-3" /> : null}
      {last ? (
        <div className="mb-3 flex min-h-[50px] items-center justify-between gap-3 border-y border-ink py-2" role="status" data-testid="clean-out-undo">
          <span className="mono truncate">{WORD[last.decision]} · {last.item.name}</span>
          {last.decision !== "keep" ? <button type="button" onClick={undo} className="pill pill-sm shrink-0" data-testid="undo-clean-out">Undo</button> : null}
        </div>
      ) : null}
      {empty ? <p className="serif text-[21px] italic leading-[1.3]">{last ? "That’s the list. Nice." : "Everything in this closet has been worn recently. Nice."}</p> : (
      <div className="flex flex-col">
        {shown.map((it) => (
          <div key={it.id} className="flex flex-col gap-2.5 border-b border-line py-3 sm:flex-row sm:items-center sm:gap-3" data-testid="clean-out-row">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Link href={`/closet/${it.id}`} className="size-14 shrink-0 bg-bone">{it.thumbKey ? <img src={`/api/photo/${it.thumbKey}`} alt="" className="size-full object-contain" /> : null}</Link>
              <div className="min-w-0 flex-1">
                <Link href={`/closet/${it.id}`} className="block truncate text-[15px] font-medium">{it.name}</Link>
                <p className="mono truncate text-graphite">{[it.categoryName, it.lastWornAt ? `Not worn since ${month(it.lastWornAt)}` : `Never worn · added ${month(it.createdAt)}`].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            {canDecide ? (
              <div className="flex shrink-0 gap-1.5 pl-[68px] sm:pl-0">
                <button type="button" disabled={busy === it.id} onClick={() => decide(it, "keep")} className="pill pill-sm pill-quiet" data-testid={`keep-${it.id}`}>Keep</button>
                <button type="button" disabled={busy === it.id} onClick={() => decide(it, "donate")} className="pill pill-sm" data-testid={`donate-${it.id}`}>Donate</button>
                <button type="button" disabled={busy === it.id} onClick={() => decide(it, "sell")} className="pill pill-sm" data-testid={`sell-${it.id}`}>Sell</button>
              </div>
            ) : null}
          </div>
        ))}
        {shown.length === 0 ? <p className="serif mt-4 text-[21px] italic leading-[1.3]">That’s the list. Nice.</p> : null}
      </div>
      )}
      {!empty ? <p className="mt-4 text-[14px] leading-snug text-graphite">Keep hides a piece from this list for 3 months. Donate and Sell retire it from the closet; the wear history stays, and a retired piece can always be brought back from its own page.</p> : null}
    </div>
  );
}

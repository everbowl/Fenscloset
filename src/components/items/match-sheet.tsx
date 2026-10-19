"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { styleMatchesAction } from "@/lib/brands/actions";
import type { Product } from "@/lib/shop/products";
import type { StyleProbe } from "@/lib/store/match";

/** "Is it this one?": the brand's styles that look like the piece; one tap fills the details and adds the store photos. */
export function MatchSheet({ open, onClose, probe, onPick, busy }: { open: boolean; onClose: () => void; probe: StyleProbe; onPick: (p: Product) => void; busy: boolean }) {
  const [rows, setRows] = useState<Product[] | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!open) return;
    setRows(null); setError(undefined);
    styleMatchesAction(probe).then((r) => { if (r.ok) setRows(r.value); else setError(r.error); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Is it this one?">
      <p className="mono text-graphite">{probe.brand} · {probe.name}</p>
      {error ? <p className="mono mt-2 text-danger">{error}</p> : null}
      {rows === null && !error ? <p className="mono py-6 text-graphite" data-testid="match-loading">Looking at {probe.brand}…</p> : null}
      {rows && rows.length === 0 ? <p className="py-6 text-[15px]" data-testid="match-empty">Nothing close at {probe.brand}. Your own details stay as they are.</p> : null}
      <div className="mt-3 flex flex-col" data-testid="match-sheet">
        {(rows ?? []).map((p, i) => (
          <button key={p.url} type="button" disabled={busy} onClick={() => onPick(p)} className="flex items-center gap-3 border-b border-line py-2 text-left disabled:opacity-60" data-testid={`match-${i}`}>
            <span className="h-[72px] w-[60px] shrink-0 overflow-hidden bg-bone">{p.imageUrl ? <img src={p.imageUrl} alt="" className="size-full object-cover" /> : null}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[15px]">{p.title}</span>
              <span className="mono text-graphite">{[p.storeName, p.priceText].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="mono shrink-0 text-ink">This one →</span>
          </button>
        ))}
      </div>
      <button type="button" onClick={onClose} className="mono mt-4 flex h-[46px] w-full items-center justify-center border border-ink" data-testid="match-none">{rows && rows.length ? "None of these" : "Close"}</button>
    </Sheet>
  );
}

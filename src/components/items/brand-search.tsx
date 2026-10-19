"use client";

import { useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { searchCatalog } from "@/lib/brands/catalog";
import { ensureBrandAction } from "@/lib/brands/actions";
import type { Named } from "@/lib/ai/tag-item";

/**
 * Brand as you type (Jeff, 19 Oct 2026): the family's brands and the national catalog narrow with
 * every letter. A catalog brand or a typed name joins the family's Brands list on first use, so it
 * stays editable in Admin → Lists → Brands.
 */
export function BrandSearch({ open, onClose, brands, selectedId, onPick, onAdded }: {
  open: boolean; onClose: () => void; brands: Named[]; selectedId: string | null; onPick: (b: Named) => void; onAdded: (b: Named) => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { if (open) { setQ(""); setError(undefined); } }, [open]);
  const fold = (s: string) => s.toLowerCase().replace(/[’']/g, "");
  const mine = useMemo(() => {
    const f = fold(q.trim());
    const rows = f ? brands.filter((b) => fold(b.name).includes(f)) : brands;
    return [...rows].sort((a, b) => Number(fold(b.name).startsWith(f)) - Number(fold(a.name).startsWith(f)) || a.name.localeCompare(b.name)).slice(0, 12);
  }, [brands, q]);
  const national = useMemo(() => searchCatalog(q).filter((c) => !brands.some((b) => fold(b.name) === fold(c.name))), [brands, q]);
  const typed = q.trim();
  const exact = typed && (brands.some((b) => fold(b.name) === fold(typed)) || national.some((c) => fold(c.name) === fold(typed)));

  function add(name: string) {
    setBusy(true); setError(undefined);
    ensureBrandAction(name).then((r) => {
      setBusy(false);
      if (!r.ok) { setError(r.error); return; }
      const b = { id: r.value.id, name: r.value.name };
      if (!brands.some((x) => x.id === b.id)) onAdded(b);
      onClose(); onPick(b);
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title="Brand">
      <Input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Start typing · Nike, Levi's, Vuori…" aria-label="Brand" data-testid="brand-search" maxLength={60} />
      {error ? <p className="mono mt-2 text-danger">{error}</p> : null}
      <div className="mt-3 flex flex-col" role="listbox" aria-label="Brands">
        {mine.map((b) => (
          <button key={b.id} type="button" role="option" aria-selected={b.id === selectedId} onClick={() => { onClose(); onPick(b); }} className="flex h-12 items-center justify-between border-b border-line text-[15px]" data-testid={`brand-pick-${b.id}`}>
            <span>{b.name}</span><span className={`mono ${b.id === selectedId ? "text-ink" : "text-graphite"}`}>{b.id === selectedId ? "✓" : "Yours"}</span>
          </button>
        ))}
        {national.map((c) => (
          <button key={c.domain + c.name} type="button" role="option" aria-selected={false} disabled={busy} onClick={() => add(c.name)} className="flex h-12 items-center justify-between border-b border-line text-[15px] disabled:opacity-60" data-testid={`brand-national-${c.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
            <span>{c.name}</span><span className="mono text-graphite">{c.domain}</span>
          </button>
        ))}
        {typed && !exact ? (
          <button type="button" disabled={busy} onClick={() => add(typed)} className="flex h-12 items-center justify-between border-b border-line text-[15px] disabled:opacity-60" data-testid="brand-use-typed">
            <span>Use “{typed}”</span><span className="mono text-graphite">{busy ? "Adding…" : "Add"}</span>
          </button>
        ) : null}
        {!mine.length && !national.length && !typed ? <p className="mono py-4 text-graphite">No brands yet · start typing</p> : null}
      </div>
    </Sheet>
  );
}

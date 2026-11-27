"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useClosetPick } from "./pick-context";
import { useState, useTransition, type ReactNode } from "react";
import { Archive, ChevronDown, SlidersHorizontal, Sparkles } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { activeFilterCount, closetQuery, emptyFilters, FACET_KEYS, SORTS, sortLabel, TOGGLE_LABEL, type ClosetFilters, type ClosetSort, type FacetKey, type Toggle } from "@/lib/items/views";
import type { Facet } from "@/lib/items/query";

const TOGGLES: Toggle[] = ["favorites", "unworn", "store"];

/**
 * The row under the chips (Alta's closet: the sort and the count on the left, the tools on the right). Sort and Filter
 * live in the URL, so a view can be shared and the back button works. A tap in the filter sheet applies at once: the
 * grid behind it and every count in the sheet follow. The picks show as chips under the row, each with its ×.
 */
export function ClosetTools({ basePath, filters, sort, facets, toggles, shown, total, cat, q, mirror = false, cleanOut = 0 }: {
  basePath: string; filters: ClosetFilters; sort: ClosetSort; facets: Facet[]; toggles: Record<Toggle, number>; shown: number; total: number; cat?: string; q?: string;
  /** The mirror can dress this closet: a Mirror button starts pick mode (F1). */ mirror?: boolean;
  /** Pieces not worn in a while: a Clean-out button with the count (H1). */ cleanOut?: number;
}) {
  const router = useRouter();
  const pick = useClosetPick();
  const [sheet, setSheet] = useState<null | "sort" | "filter">(null);
  const [applying, start] = useTransition();
  const n = activeFilterCount(filters);
  // A pick applies in a transition: the row and the count dim until the new grid is in, so a tap always answers at once.
  const go = (next: { filters?: ClosetFilters; sort?: ClosetSort }, mode: "push" | "replace" = "replace") => {
    start(() => { router[mode](`${basePath}${closetQuery({ filters: next.filters ?? filters, sort: next.sort ?? sort, cat, q })}`, { scroll: false }); });
  };
  const toggleId = (key: FacetKey, id: string) => go({ filters: { ...filters, [key]: filters[key].includes(id) ? filters[key].filter((x) => x !== id) : [...filters[key], id] } });
  const toggleFlag = (t: Toggle) => go({ filters: { ...filters, [t]: !filters[t] } });
  const clear = () => go({ filters: emptyFilters() });
  const nameOf = (key: FacetKey, id: string) => facets.find((f) => f.key === key)?.options.find((o) => o.id === id)?.name ?? "…";
  const chips: { label: string; off: () => void }[] = [
    ...FACET_KEYS.flatMap((k) => filters[k].map((id) => ({ label: nameOf(k, id), off: () => toggleId(k, id) }))),
    ...TOGGLES.filter((t) => filters[t]).map((t) => ({ label: TOGGLE_LABEL[t], off: () => toggleFlag(t) })),
  ];
  const nothingToFilter = !facets.length && !toggles.favorites && !toggles.unworn && n === 0;
  const pieces = `${shown} of ${total} ${total === 1 ? "piece" : "pieces"}`;
  const tool = "relative flex size-10 items-center justify-center rounded-full bg-bone text-ink active:bg-[#e2e1dc]";

  return (
    <>
      <div className={cn("mt-2 flex items-center justify-between gap-2 transition-opacity", applying && "opacity-60")} aria-busy={applying || undefined} data-testid="closet-tools">
        <div className="flex min-w-0 items-center gap-1.5">
          <button type="button" onClick={() => setSheet("sort")} aria-haspopup="dialog" className="tap -ml-1 flex h-10 shrink-0 items-center gap-0.5 rounded-full px-1 text-[15px] font-semibold" data-testid="sort-button">{sortLabel(sort)}<ChevronDown className="size-4 text-graphite" strokeWidth={2.5} /></button>
          <span className="caption truncate">· {n || q || cat ? pieces : `${total} ${total === 1 ? "piece" : "pieces"}`}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => setSheet("filter")} aria-haspopup="dialog" aria-label={n ? `Filter, ${n} on` : "Filter"} className={cn(tool, n > 0 && "bg-ink text-paper")} data-testid="filter-button">
            <SlidersHorizontal className="size-[18px]" strokeWidth={2} />
            {n > 0 ? <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-ink">{n}</span> : null}
          </button>
          {mirror ? <button type="button" onClick={() => pick.setPicking(!pick.picking)} aria-pressed={pick.picking} aria-label="Mirror: pick pieces to see on you" title="Mirror" className={cn(tool, pick.picking && "bg-ink text-paper")} data-testid="closet-mirror"><Sparkles className="size-[18px]" strokeWidth={2} /></button> : null}
          {cleanOut > 0 ? <Link href="/closet/clean-out" aria-label={`Clean-out, ${cleanOut} pieces`} title="Clean-out" className={tool} data-testid="closet-clean-out"><Archive className="size-[18px]" strokeWidth={2} /><span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-ink text-[10px] font-semibold text-paper">{cleanOut}</span></Link> : null}
        </div>
      </div>
      {chips.length ? (
        <div className="strip -mx-5 mt-2 items-center gap-2 px-5 py-0.5">
          {chips.map((c) => (
            <button key={c.label} type="button" onClick={c.off} aria-label={`Remove ${c.label}`} className="pill pill-sm pill-on shrink-0" data-testid="filter-chip">
              {c.label} <span aria-hidden>×</span>
            </button>
          ))}
          {n > 0 ? <button type="button" onClick={clear} className="pill pill-sm pill-quiet shrink-0" data-testid="filter-clear">Clear all</button> : null}
        </div>
      ) : null}

      <Sheet open={sheet === "sort"} onClose={() => setSheet(null)} title="Sort">
        {sheet === "sort" ? <div role="listbox" aria-label="Sort" className="flex flex-col" data-testid="sort-sheet">
          {SORTS.map((s) => {
            const on = s.value === sort;
            return (
              <button key={s.value} type="button" role="option" aria-selected={on} onClick={() => { setSheet(null); go({ sort: s.value }, "push"); }}
                className="tap flex h-12 items-center justify-between rounded-xl px-1 text-[16px]">
                <span>{s.label}</span>
                <span className={cn("text-[15px]", on ? "text-ink" : "text-transparent")}>{on ? "✓" : "·"}</span>
              </button>
            );
          })}
        </div> : null}
      </Sheet>

      {/* The sheet's body exists only while it is open: a closed dialog must not leave a second "N of M pieces" in the page. */}
      <Sheet open={sheet === "filter"} onClose={() => setSheet(null)} title="Filter">
        {sheet === "filter" ? <div data-testid="filter-sheet">
          <p className={cn("caption transition-opacity", applying && "opacity-50")} aria-live="polite" data-testid="filter-count">{pieces}</p>
          {nothingToFilter ? (
            <p className="note mt-4">Nothing to filter yet. A piece's page is where its color, season and the rest get set.</p>
          ) : null}
          {toggles.favorites || toggles.unworn || filters.favorites || filters.unworn ? (
            <Section label="Only">
              {TOGGLES.filter((t) => toggles[t] > 0 || filters[t]).map((t) => (
                <Chip key={t} on={filters[t]} onClick={() => toggleFlag(t)} label={TOGGLE_LABEL[t]} count={toggles[t]} />
              ))}
            </Section>
          ) : null}
          {facets.map((f) => (
            <Section key={f.key} label={f.label}>
              {f.options.map((o) => <Chip key={o.id} on={filters[f.key].includes(o.id)} onClick={() => toggleId(f.key, o.id)} label={o.name} count={o.count} hex={o.hex} />)}
            </Section>
          ))}
          <div className="mt-6 flex items-center justify-between gap-3">
            {n > 0 ? <button type="button" onClick={clear} className="pill pill-quiet" data-testid="filter-sheet-clear">Clear all</button> : <span />}
            <Button type="button" variant="secondary" size="md" onClick={() => setSheet(null)} data-testid="filter-done">Done</Button>
          </div>
        </div> : null}
      </Sheet>
    </>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="caption mb-2">{label}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

/** One filter option: its name, how many pieces it would show, a swatch for a color. Pressed = picked. */
function Chip({ on, onClick, label, count, hex }: { on: boolean; onClick: () => void; label: string; count: number; hex?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className="pill pill-sm" data-testid="filter-option">
      {hex ? <span aria-hidden className={cn("size-3 shrink-0 rounded-full border", on ? "border-paper" : "border-line")} style={{ background: hex }} /> : null}
      <span>{label}</span>
      <span className="opacity-60">{count}</span>
    </button>
  );
}

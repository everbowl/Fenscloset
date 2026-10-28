"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { activeFilterCount, closetQuery, emptyFilters, FACET_KEYS, SORTS, sortLabel, TOGGLE_LABEL, type ClosetFilters, type ClosetSort, type FacetKey, type Toggle } from "@/lib/items/views";
import type { Facet } from "@/lib/items/query";

const TOGGLES: Toggle[] = ["favorites", "unworn"];

/**
 * Sort and Filter under the category tabs (Shop v2 item 5; Jeff: "C", both). Each lives in the URL, so a view can
 * be shared and the back button works. A tap in the filter sheet applies at once: the grid behind it and every
 * count in the sheet follow, so nobody has to guess what a pick will leave. The picks show as chips, each with its ×.
 */
export function ClosetTools({ basePath, filters, sort, facets, toggles, shown, total, cat, q }: {
  basePath: string; filters: ClosetFilters; sort: ClosetSort; facets: Facet[]; toggles: Record<Toggle, number>; shown: number; total: number; cat?: string; q?: string;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<null | "sort" | "filter">(null);
  const n = activeFilterCount(filters);
  const go = (next: { filters?: ClosetFilters; sort?: ClosetSort }, mode: "push" | "replace" = "replace") => {
    router[mode](`${basePath}${closetQuery({ filters: next.filters ?? filters, sort: next.sort ?? sort, cat, q })}`, { scroll: false });
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

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="closet-tools">
        <button type="button" onClick={() => setSheet("sort")} aria-haspopup="dialog" className="pill pill-sm" data-testid="sort-button">Sort · {sortLabel(sort)}</button>
        <button type="button" onClick={() => setSheet("filter")} aria-haspopup="dialog" className={cn("pill pill-sm", n > 0 && "pill-solid")} data-testid="filter-button">{n ? `Filter · ${n}` : "Filter"}</button>
        {chips.map((c) => (
          <button key={c.label} type="button" onClick={c.off} aria-label={`Remove ${c.label}`} className="pill pill-sm" data-testid="filter-chip">
            {c.label} <span aria-hidden>×</span>
          </button>
        ))}
        {n > 0 ? <button type="button" onClick={clear} className="pill pill-sm pill-quiet" data-testid="filter-clear">Clear all</button> : null}
      </div>

      <Sheet open={sheet === "sort"} onClose={() => setSheet(null)} title="Sort">
        {sheet === "sort" ? <div role="listbox" aria-label="Sort" className="flex flex-col" data-testid="sort-sheet">
          {SORTS.map((s) => {
            const on = s.value === sort;
            return (
              <button key={s.value} type="button" role="option" aria-selected={on} onClick={() => { setSheet(null); go({ sort: s.value }, "push"); }}
                className="flex h-12 items-center justify-between border-b border-line text-[15px]">
                <span>{s.label}</span>
                <span className={cn("mono", on ? "text-ink" : "text-transparent")}>{on ? "✓" : "·"}</span>
              </button>
            );
          })}
        </div> : null}
      </Sheet>

      {/* The sheet's body exists only while it is open: a closed dialog must not leave a second "N of M pieces" in the page. */}
      <Sheet open={sheet === "filter"} onClose={() => setSheet(null)} title="Filter">
        {sheet === "filter" ? <div data-testid="filter-sheet">
          <p className="mono text-graphite" aria-live="polite" data-testid="filter-count">{pieces}</p>
          {nothingToFilter ? (
            <p className="mono mt-4 text-graphite">Nothing to filter yet · a piece's page is where its color, season and the rest get set</p>
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
      <h3 className="mono mb-2 text-graphite">{label}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

/** One filter option: its name, how many pieces it would show, a swatch for a color. Pressed = picked. */
function Chip({ on, onClick, label, count, hex }: { on: boolean; onClick: () => void; label: string; count: number; hex?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("pill pill-sm normal-case tracking-normal", on && "pill-solid")} data-testid="filter-option">
      {hex ? <span aria-hidden className={cn("size-3 shrink-0 rounded-full border", on ? "border-paper" : "border-line")} style={{ background: hex }} /> : null}
      <span>{label}</span>
      <span className="opacity-60">{count}</span>
    </button>
  );
}

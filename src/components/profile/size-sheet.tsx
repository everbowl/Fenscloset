"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/**
 * One tap on a size (or a measurement): chips from the editable list, the likely one marked, and
 * "Other…" for anything the list doesn't have. Jeff, 18 Oct 2026: no more guessing what "32"
 * means for a T-shirt.
 */
export function SizeSheet({ open, onClose, title, options, value, suggested, unit, format, onPick, testId = "size-sheet" }: {
  open: boolean; onClose: () => void; title: string; options: string[]; value: string | null; suggested?: string | null; unit?: string;
  /** How an option reads on its chip (e.g. inches → 5'11"). */
  format?: (v: string) => string; onPick: (value: string | null) => void; testId?: string;
}) {
  const [other, setOther] = useState<string | null>(null);
  const show = (v: string) => (format ? format(v) : v);
  const pick = (v: string | null) => { setOther(null); onClose(); onPick(v); };
  return (
    <Sheet open={open} onClose={() => { setOther(null); onClose(); }} title={title}>
      <div data-testid={testId}>
        {suggested && !options.includes(suggested) ? <p className="mono mb-2 text-graphite">Likely {show(suggested)} from your height and weight</p> : null}
        <div className="flex flex-wrap gap-1.5" role="listbox">
          {options.map((o) => {
            const on = o === value;
            const likely = o === suggested && !on;
            return (
              <button key={o} type="button" role="option" aria-selected={on} onClick={() => pick(o)} data-testid={`size-${o.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
                className={cn("mono mono-11 h-9 min-w-11 px-3", on ? "bg-ink text-paper" : likely ? "border border-dashed border-ink" : "border border-line")}>
                {show(o)}{likely ? <span className="ml-1 text-graphite">likely</span> : null}
              </button>
            );
          })}
        </div>
        {other === null ? (
          <div className="mt-4 flex items-center justify-between">
            <button type="button" onClick={() => setOther(value && !options.includes(value) ? value : "")} className="pill pill-sm" data-testid="size-other">Other…</button>
            {value ? <button type="button" onClick={() => pick(null)} className="pill pill-sm pill-quiet" data-testid="size-clear">Clear</button> : null}
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (other.trim()) pick(other.trim()); }} className="mt-4 flex items-end gap-2">
            <div className="flex-1"><Field label={unit ? `Other (${unit})` : "Other"} htmlFor="size-other-input"><Input id="size-other-input" value={other} onChange={(e) => setOther(e.target.value)} maxLength={20} autoFocus data-testid="size-other-input" /></Field></div>
            <Button type="submit" variant="secondary">Use</Button>
          </form>
        )}
      </div>
    </Sheet>
  );
}

"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { InlineAdd } from "@/components/lists/inline-add";
import { AskToAdd } from "@/components/lists/ask-to-add";
import { cn } from "@/lib/cn";
import type { ListKind } from "@/lib/lists/registry";
import type { Named } from "@/lib/ai/tag-item";

/** One tappable row: KEY · value · chevron. The whole confirm screen is a stack of these. `trailing` sits before the chevron (an "Open ↗" link next to a saved URL). */
export function Row({ label, value, muted, onClick, testId, trailing }: { label: string; value: string; muted?: boolean; onClick: () => void; testId?: string; trailing?: ReactNode }) {
  const button = (
    <button type="button" onClick={onClick} data-testid={testId} className={cn("tap flex h-12 w-full min-w-0 items-center text-left", !trailing && "border-b border-line")}>
      <span className="mono w-[120px] shrink-0 text-graphite">{label}</span>
      <span className={cn("flex-1 truncate text-[14px]", muted && "text-graphite")}>{value}</span>
      {!trailing ? <Chevron /> : null}
    </button>
  );
  if (!trailing) return button;
  return <div className="flex items-center gap-2 border-b border-line">{button}{trailing}<Chevron /></div>;
}

function Chevron() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="shrink-0 text-graphite"><path d="m9 6 6 6-6 6" /></svg>;
}

/**
 * Picker sheet for a list-backed row. Options come from the editable lists; admins get `+ Add`
 * right here so they never leave the screen. `multi` allows several (colors, seasons). On a
 * single choice, tapping the one already checked just closes; `clearable` adds a Clear pill for
 * the rows that may be empty (pattern, fabric, store…).
 */
export function PickSheet({ open, onClose, title, kind, options, selected, multi, canAdd, onChange, parentId, onAdded, clearable }: {
  open: boolean; onClose: () => void; title: string; kind: ListKind; options: (Named & { hex?: string | null })[]; selected: string[]; multi?: boolean;
  canAdd: boolean; onChange: (ids: string[]) => void; parentId?: string; onAdded?: (entry: Named) => void; clearable?: boolean;
}) {
  function toggle(id: string) {
    if (multi) { onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]); return; }
    onClose(); // close first so onChange may open a follow-up sheet
    if (selected[0] !== id) onChange([id]);
  }
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col" role="listbox" aria-multiselectable={multi}>
        {options.map((o) => {
          const on = selected.includes(o.id);
          return (
            <button key={o.id} type="button" role="option" aria-selected={on} onClick={() => toggle(o.id)} className="tap flex h-12 items-center justify-between border-b border-line text-[15px]">
              <span className="flex items-center gap-3">{o.hex ? <span aria-hidden className="size-4 shrink-0 rounded-full border border-line" style={{ background: o.hex }} /> : null}{o.name}</span>
              <span className={cn("mono", on ? "text-ink" : "text-transparent")}>{on ? "✓" : "·"}</span>
            </button>
          );
        })}
        {options.length === 0 ? <p className="mono py-4 text-graphite">Nothing in this list yet</p> : null}
      </div>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        {canAdd ? <InlineAdd kind={kind} parentId={parentId} inline onCreated={(e) => { onAdded?.({ id: e.id, name: e.name }); if (!multi) onClose(); onChange(multi ? [...selected, e.id] : [e.id]); }} /> : <AskToAdd kind={kind} parentId={parentId} />}
        <span className="flex items-center gap-2">
          {clearable && !multi && selected.length ? <button type="button" onClick={() => { onClose(); onChange([]); }} className="pill pill-sm pill-quiet" data-testid="pick-clear">Clear</button> : null}
          {multi ? <Button type="button" size="md" onClick={onClose}>Done</Button> : null}
        </span>
      </div>
    </Sheet>
  );
}

/** What a text sheet is for: the keyboard, the length and the field follow. */
export type TextKind = "text" | "url" | "decimal" | "zip" | "multiline";
const KIND_PROPS: Record<TextKind, React.InputHTMLAttributes<HTMLInputElement>> = {
  text: { maxLength: 80 },
  url: { type: "url", inputMode: "url", autoCapitalize: "none", autoCorrect: "off", spellCheck: false, maxLength: 2000 },
  decimal: { inputMode: "decimal", maxLength: 20 },
  zip: { inputMode: "numeric", autoComplete: "postal-code", pattern: "[0-9]*", maxLength: 10 },
  multiline: {},
};

/** Resets to `value` every time it opens, so an abandoned edit never comes back. */
function useSheetValue<T>(open: boolean, value: T): [T, (v: T) => void] {
  const [v, setV] = useState(value);
  const wasOpen = useRef(false);
  useEffect(() => { if (open && !wasOpen.current) setV(value); wasOpen.current = open; }, [open, value]);
  return [v, setV];
}

export function TextSheet({ open, onClose, title, label, value, onSave, placeholder, kind = "text", hint, submitLabel = "Save", valid }: {
  open: boolean; onClose: () => void; title: string; label: string; value: string; onSave: (v: string) => void; placeholder?: string;
  kind?: TextKind; hint?: string; submitLabel?: string; /** When given, the button waits until the text passes. */ valid?: (v: string) => boolean;
}) {
  const [v, setV] = useSheetValue(open, value);
  const id = useId();
  const ok = valid ? valid(v) : true;
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form onSubmit={(e) => { e.preventDefault(); if (!ok) return; onSave(v); onClose(); }} className="space-y-5">
        <Field label={label} htmlFor={id} hint={hint}>
          {kind === "multiline"
            ? <Textarea id={id} value={v} onChange={(e) => setV(e.target.value)} autoFocus maxLength={500} placeholder={placeholder} rows={4} />
            : <Input id={id} value={v} onChange={(e) => setV(e.target.value)} autoFocus placeholder={placeholder} {...KIND_PROPS[kind]} />}
        </Field>
        <Button type="submit" className="w-full" disabled={!ok} data-testid="text-sheet-save">{submitLabel}</Button>
      </form>
    </Sheet>
  );
}

/** Price and the day it was bought, in one sheet (the two used to be chained and the second never opened). */
export function PriceDateSheet({ open, onClose, price, date, onSave }: {
  open: boolean; onClose: () => void; price: string; date: string; onSave: (v: { price: string; date: string }) => void;
}) {
  const [p, setP] = useSheetValue(open, price);
  const [d, setD] = useSheetValue(open, date);
  const id = useId();
  return (
    <Sheet open={open} onClose={onClose} title="Price · Date">
      <form onSubmit={(e) => { e.preventDefault(); onSave({ price: p, date: d }); onClose(); }} className="space-y-5">
        <Field label="Price" htmlFor={`${id}-price`}>
          <Input id={`${id}-price`} value={p} onChange={(e) => setP(e.target.value)} autoFocus placeholder="48.50" {...KIND_PROPS.decimal} data-testid="price-input" />
        </Field>
        <Field label="Bought on" htmlFor={`${id}-date`}>
          <Input id={`${id}-date`} type="date" value={d} onChange={(e) => setD(e.target.value)} className="h-11" data-testid="date-input" />
        </Field>
        <Button type="submit" className="w-full" data-testid="price-date-save">Save</Button>
      </form>
    </Sheet>
  );
}

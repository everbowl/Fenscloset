"use client";

import { useId, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { InlineAdd } from "@/components/lists/inline-add";
import { cn } from "@/lib/cn";
import type { ListKind } from "@/lib/lists/registry";
import type { Named } from "@/lib/ai/tag-item";

/** One 42px tappable row: KEY · value · chevron. The whole confirm screen is a stack of these. */
export function Row({ label, value, muted, onClick, testId }: { label: string; value: string; muted?: boolean; onClick: () => void; testId?: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} className="flex h-[42px] w-full items-center border-b border-line text-left">
      <span className="mono w-[120px] shrink-0 text-graphite">{label}</span>
      <span className={cn("flex-1 truncate text-[14px]", muted && "text-graphite")}>{value}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" strokeWidth="2" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
    </button>
  );
}

/**
 * Picker sheet for a list-backed row. Options come from the editable lists; admins get `+ Add`
 * right here so they never leave the screen. `multi` allows several (colours, seasons).
 */
export function PickSheet({ open, onClose, title, kind, options, selected, multi, canAdd, onChange, parentId, onAdded }: {
  open: boolean; onClose: () => void; title: string; kind: ListKind; options: Named[]; selected: string[]; multi?: boolean;
  canAdd: boolean; onChange: (ids: string[]) => void; parentId?: string; onAdded?: (entry: Named) => void;
}) {
  function toggle(id: string) {
    if (multi) onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else { onClose(); onChange(selected[0] === id ? [] : [id]); } // close first so onChange may open a follow-up sheet
  }
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col" role="listbox" aria-multiselectable={multi}>
        {options.map((o) => {
          const on = selected.includes(o.id);
          return (
            <button key={o.id} type="button" role="option" aria-selected={on} onClick={() => toggle(o.id)} className="flex h-12 items-center justify-between border-b border-line text-[15px]">
              <span>{o.name}</span>
              <span className={cn("mono", on ? "text-ink" : "text-transparent")}>{on ? "✓" : "·"}</span>
            </button>
          );
        })}
        {options.length === 0 ? <p className="mono py-4 text-graphite">Nothing in this list yet</p> : null}
      </div>
      <div className="mt-4 flex items-center justify-between">
        {canAdd ? <InlineAdd kind={kind} parentId={parentId} onCreated={(e) => { onAdded?.({ id: e.id, name: e.name }); if (!multi) onClose(); onChange(multi ? [...selected, e.id] : [e.id]); }} /> : <span />}
        {multi ? <Button type="button" size="md" onClick={onClose}>Done</Button> : null}
      </div>
    </Sheet>
  );
}

export function TextSheet({ open, onClose, title, label, value, onSave, placeholder }: {
  open: boolean; onClose: () => void; title: string; label: string; value: string; onSave: (v: string) => void; placeholder?: string;
}) {
  const [v, setV] = useState(value);
  const id = useId();
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form onSubmit={(e) => { e.preventDefault(); onSave(v); onClose(); }} className="space-y-5">
        <Field label={label} htmlFor={id}>
          <Input id={id} value={v} onChange={(e) => setV(e.target.value)} autoFocus maxLength={80} placeholder={placeholder} />
        </Field>
        <Button type="submit" className="w-full">Save</Button>
      </form>
    </Sheet>
  );
}

"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { LIST_DEFS, type ListKind } from "@/lib/lists/registry";
import type { ListEntry } from "@/lib/lists/service";
import { createEntryAction } from "@/app/(app)/admin/lists/actions";
import { EntryExtraFields } from "./entry-fields";

/**
 * "+ Add <thing>" that works anywhere a list is used, so an admin never has to leave the screen.
 * Opens a small sheet, creates the entry, hands it back through onCreated.
 */
export function InlineAdd({ kind, parentId, onCreated, label, variant = "ghost", size = "sm", inline, initialName, testId }: {
  kind: ListKind;
  parentId?: string;
  onCreated?: (entry: ListEntry) => void;
  label?: string;
  variant?: "ghost" | "secondary" | "primary";
  size?: "sm" | "md" | "lg";
  /** Inside a sheet: the form opens as a row right here instead of a second sheet. */
  inline?: boolean;
  /** A name already chosen (an ask from the family). */
  initialName?: string;
  testId?: string;
}) {
  const def = LIST_DEFS[kind];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName ?? "");
  const [extra, setExtra] = useState<{ hex?: string; url?: string; photoTip?: string; prompt?: string; needs?: string }>({ hex: "#888888" });
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await createEntryAction(kind, { name, parentId, ...extra });
      if (!res.ok) { setError(res.error); return; }
      setName(initialName ?? ""); setError(undefined); setOpen(false);
      onCreated?.(res.entry);
    });
  }

  if (inline) {
    return open ? (
      <form onSubmit={submit} className="flex w-full flex-col gap-3 border-t border-line pt-3" data-testid={`inline-add-form-${kind}`}>
        <Field label={`New ${def.singular}`} htmlFor="inline-add-name" error={error}>
          <Input id="inline-add-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={60} />
        </Field>
        <EntryExtraFields fields={def.extraFields} values={extra} onChange={(p) => setExtra((x) => ({ ...x, ...p }))} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending}>{pending ? "Adding…" : `Add ${def.singular}`}</Button>
          <button type="button" className="pill pill-sm pill-quiet" onClick={() => { setOpen(false); setError(undefined); }}>Cancel</button>
        </div>
      </form>
    ) : (
      <button type="button" onClick={() => setOpen(true)} className="pill pill-sm" data-testid={`inline-add-${kind}`}><Plus className="size-3.5" strokeWidth={1.8} /> {label ?? `Add ${def.singular}`}</button>
    );
  }
  return (
    <>
      {variant === "ghost"
        ? <button type="button" onClick={() => setOpen(true)} className={size === "sm" ? "pill pill-sm" : "pill"} data-testid={testId ?? `inline-add-${kind}`}><Plus className="size-3.5" strokeWidth={1.8} /> {label ?? `Add ${def.singular}`}</button>
        : <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)} data-testid={`inline-add-${kind}`}><Plus className="size-3.5" strokeWidth={1.8} /> {label ?? `Add ${def.singular}`}</Button>}
      <Sheet open={open} onClose={() => setOpen(false)} title={`New ${def.singular}`}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Name" htmlFor="inline-add-name" error={error}>
            <Input id="inline-add-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={60} />
          </Field>
          <EntryExtraFields fields={def.extraFields} values={extra} onChange={(p) => setExtra((x) => ({ ...x, ...p }))} />
          <Button type="submit" className="w-full" disabled={pending}>{pending ? "Adding…" : `Add ${def.singular}`}</Button>
        </form>
      </Sheet>
    </>
  );
}

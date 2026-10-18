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
export function InlineAdd({ kind, parentId, onCreated, label, variant = "ghost", size = "sm" }: {
  kind: ListKind;
  parentId?: string;
  onCreated?: (entry: ListEntry) => void;
  label?: string;
  variant?: "ghost" | "secondary" | "primary";
  size?: "sm" | "md" | "lg";
}) {
  const def = LIST_DEFS[kind];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [extra, setExtra] = useState<{ hex?: string; url?: string; photoTip?: string }>({ hex: "#888888" });
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await createEntryAction(kind, { name, parentId, ...extra });
      if (!res.ok) { setError(res.error); return; }
      setName(""); setError(undefined); setOpen(false);
      onCreated?.(res.entry);
    });
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        <Plus className="size-3.5" strokeWidth={1.8} /> {label ?? `Add ${def.singular}`}
      </Button>
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

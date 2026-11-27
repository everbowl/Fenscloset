"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { LIST_DEFS, type ListKind } from "@/lib/lists/registry";
import { requestEntryAction } from "@/app/(app)/admin/lists/actions";

/** For everyone who can't edit a list (J1): type the word, an admin sees it under Lists and adds it. */
export function AskToAdd({ kind, parentId }: { kind: ListKind; parentId?: string }) {
  const def = LIST_DEFS[kind];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="pill pill-sm" data-testid={`ask-add-${kind}`}>Ask to add a {def.singular}</button>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await requestEntryAction(kind, name, parentId); if (!r.ok) { toast.error(r.error); return; } toast.ok(r.already ? `Already asked · ${r.admins} will see it` : `Asked · ${r.admins} will see it under Lists`); setName(""); setOpen(false); }); }} className="flex w-full items-end gap-2 border-t border-line pt-3" data-testid={`ask-add-form-${kind}`}>
      <div className="min-w-0 flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={60} placeholder={`A ${def.singular} that is missing`} aria-label={`${def.singular} to ask for`} /></div>
      <button type="submit" disabled={pending || !name.trim()} className="pill pill-sm pill-solid shrink-0" data-testid={`ask-add-send-${kind}`}>{pending ? "Asking…" : "Ask"}</button>
      <button type="button" onClick={() => { setOpen(false); setName(""); }} className="pill pill-sm pill-quiet shrink-0">Cancel</button>
    </form>
  );
}

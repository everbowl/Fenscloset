"use client";

import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banner } from "@/components/ui/banner";
import { Sheet } from "@/components/ui/sheet";
import { Card } from "@/components/ui/card";
import { LIST_DEFS, type ListKind } from "@/lib/lists/registry";
import type { ListEntry } from "@/lib/lists/service";
import { deleteEntryAction, reorderEntriesAction, updateEntryAction } from "@/app/(app)/admin/lists/actions";
import { InlineAdd } from "./inline-add";
import { EntryExtraFields } from "./entry-fields";
import { cn } from "@/lib/cn";

export function ListEditor({ kind, entries: initial, parentId }: { kind: ListKind; entries: ListEntry[]; parentId?: string }) {
  const def = LIST_DEFS[kind];
  const router = useRouter();
  const [entries, setEntries] = useState(initial);
  const [editing, setEditing] = useState<ListEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ListEntry | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const active = entries.filter((e) => !e.isArchived);
  const archived = entries.filter((e) => e.isArchived);

  function patch(updated: ListEntry) {
    setEntries((list) => list.map((e) => (e.id === updated.id ? updated : e)));
  }

  function move(entry: ListEntry, dir: -1 | 1) {
    const idx = active.findIndex((e) => e.id === entry.id);
    const target = idx + dir;
    if (target < 0 || target >= active.length) return;
    const next = [...active];
    [next[idx], next[target]] = [next[target], next[idx]];
    const reordered = next.map((e, i) => ({ ...e, sortOrder: i }));
    setEntries([...reordered, ...archived]);
    start(async () => {
      const res = await reorderEntriesAction(kind, reordered.map((e) => e.id));
      if (!res.ok) setError(res.error);
    });
  }

  function toggleArchive(entry: ListEntry) {
    start(async () => {
      const res = await updateEntryAction(kind, entry.id, { isArchived: !entry.isArchived });
      if (!res.ok) { setError(res.error); return; }
      patch(res.entry);
    });
  }

  function saveEdit(values: { name: string; hex?: string; url?: string }) {
    if (!editing) return;
    start(async () => {
      const res = await updateEntryAction(kind, editing.id, values);
      if (!res.ok) { setError(res.error); return; }
      patch(res.entry); setEditing(null); setError(undefined);
    });
  }

  function doDelete() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    start(async () => {
      const res = await deleteEntryAction(kind, target.id);
      if (!res.ok) { setError(res.error); setConfirmDelete(null); return; }
      setEntries((list) => list.filter((e) => e.id !== target.id)); setConfirmDelete(null); setError(undefined);
    });
  }

  const protectedCloset = (e: ListEntry) => kind === "closet" && e.closetKind !== "custom";

  return (
    <div className="space-y-4">
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{active.length} {active.length === 1 ? def.singular : def.label.toLowerCase()}</p>
        <InlineAdd kind={kind} parentId={parentId} variant="primary" size="sm" onCreated={(e) => { setEntries((l) => [...l, e]); router.refresh(); }} />
      </div>

      <Card className="divide-y divide-border p-0">
        {active.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">Nothing here yet. Add the first one.</p> : null}
        {active.map((entry, i) => (
          <div key={entry.id} className={cn("flex items-center gap-2 px-3 py-2", pending && "opacity-70")}>
            {entry.hex ? <span className="size-6 shrink-0 rounded-full border border-border" style={{ background: entry.hex }} aria-hidden /> : null}
            <button type="button" onClick={() => setEditing(entry)} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left">
              <span className="truncate text-[15px]">{entry.name}</span>
              {entry.closetKind && entry.closetKind !== "custom" ? <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-muted">{entry.closetKind}</span> : null}
              {entry.url ? <span className="truncate text-xs text-muted">{entry.url.replace(/^https?:\/\//, "")}</span> : null}
              <Pencil className="ml-auto size-4 shrink-0 text-stone-400" aria-hidden />
            </button>
            <div className="flex shrink-0 items-center">
              <IconBtn label="Move up" disabled={i === 0} onClick={() => move(entry, -1)}><ArrowUp className="size-4" /></IconBtn>
              <IconBtn label="Move down" disabled={i === active.length - 1} onClick={() => move(entry, 1)}><ArrowDown className="size-4" /></IconBtn>
              {!protectedCloset(entry) ? (
                <>
                  <IconBtn label="Archive" onClick={() => toggleArchive(entry)}><Archive className="size-4" /></IconBtn>
                  <IconBtn label="Delete" onClick={() => setConfirmDelete(entry)} danger><Trash2 className="size-4" /></IconBtn>
                </>
              ) : null}
            </div>
          </div>
        ))}
      </Card>

      {archived.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer select-none text-sm font-medium text-muted">Archived ({archived.length})</summary>
          <Card className="mt-2 divide-y divide-border p-0">
            {archived.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 px-3 py-2 text-muted">
                <span className="flex-1 truncate py-2 text-[15px] line-through">{entry.name}</span>
                <IconBtn label="Restore" onClick={() => toggleArchive(entry)}><ArchiveRestore className="size-4" /></IconBtn>
                <IconBtn label="Delete" onClick={() => setConfirmDelete(entry)} danger><Trash2 className="size-4" /></IconBtn>
              </div>
            ))}
          </Card>
        </details>
      ) : null}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={`Edit ${def.singular}`}>
        {editing ? <EditForm key={editing.id} entry={editing} kind={kind} onSave={saveEdit} pending={pending} /> : null}
      </Sheet>

      <Sheet open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title={`Delete “${confirmDelete?.name}”?`}>
        <p className="text-sm text-muted">This can&apos;t be undone. If anything still uses it, the app will stop you and suggest archiving instead.</p>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(null)}><X className="size-4" /> Keep</Button>
          <Button variant="danger" className="flex-1" onClick={doDelete} disabled={pending}><Trash2 className="size-4" /> Delete</Button>
        </div>
      </Sheet>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className={cn("flex size-10 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 disabled:opacity-30", danger && "hover:bg-red-50 hover:text-danger")}>
      {children}
    </button>
  );
}

function EditForm({ entry, kind, onSave, pending }: { entry: ListEntry; kind: ListKind; onSave: (v: { name: string; hex?: string; url?: string }) => void; pending: boolean }) {
  const def = LIST_DEFS[kind];
  const [name, setName] = useState(entry.name);
  const [extra, setExtra] = useState<{ hex?: string; url?: string }>({ hex: entry.hex, url: entry.url ?? "" });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ name, ...extra }); }} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="edit-name" className="block text-sm font-medium">Name</label>
        <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={60} />
      </div>
      <EntryExtraFields fields={def.extraFields} values={extra} onChange={(p) => setExtra((x) => ({ ...x, ...p }))} />
      <Button type="submit" className="w-full" disabled={pending}><Check className="size-4" /> Save</Button>
    </form>
  );
}

"use client";

import { Archive, ArchiveRestore, ArrowDown, ArrowUp, GripVertical, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
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
  // Find in a long list (the brand catalog is ~190 rows); moving is off while a filter is on, since positions would not line up.
  const [q, setQ] = useState("");
  const filtering = q.trim().length > 0;
  const shown = filtering ? active.filter((e) => e.name.toLowerCase().includes(q.trim().toLowerCase())) : active;

  // Drag to reorder (Jeff, 19 Oct 2026): press the grip, move, let go. Pointer events, so it works with a finger too.
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number; h: number } | null>(null);
  const dragStart = useRef<{ y: number; from: number; h: number; to: number } | null>(null); // `to` lives in the ref too: pointerup can land before React re-renders with the latest state
  function onGripDown(e: React.PointerEvent<HTMLButtonElement>, i: number) {
    if (filtering) return;
    const h = rowRefs.current[i]?.getBoundingClientRect().height ?? 48;
    dragStart.current = { y: e.clientY, from: i, h, to: i };
    (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
    setDrag({ from: i, to: i, dy: 0, h });
  }
  function onGripMove(e: React.PointerEvent<HTMLButtonElement>) {
    const st = dragStart.current; if (!st) return;
    const dy = e.clientY - st.y;
    const to = Math.max(0, Math.min(active.length - 1, st.from + Math.round(dy / st.h)));
    st.to = to;
    setDrag({ from: st.from, to, dy, h: st.h });
  }
  function onGripUp() {
    const st = dragStart.current; dragStart.current = null; setDrag(null);
    if (!st || st.to === st.from) return;
    const next = [...active]; const [row] = next.splice(st.from, 1); next.splice(st.to, 0, row);
    const reordered = next.map((e, i) => ({ ...e, sortOrder: i }));
    setEntries([...reordered, ...archived]);
    start(async () => { const res = await reorderEntriesAction(kind, reordered.map((e) => e.id)); if (!res.ok) setError(res.error); });
  }
  /** Where a row sits while something is being dragged: the dragged row follows the finger, the rows it passes slide out of the way. */
  function dragStyle(i: number): React.CSSProperties | undefined {
    if (!drag) return undefined;
    if (i === drag.from) return { transform: `translateY(${drag.dy}px)`, zIndex: 10, position: "relative", background: "var(--color-paper)", boxShadow: "0 0 0 1px var(--color-ink)" };
    if (drag.to > drag.from && i > drag.from && i <= drag.to) return { transform: `translateY(-${drag.h}px)`, transition: "transform 120ms" };
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return { transform: `translateY(${drag.h}px)`, transition: "transform 120ms" };
    return { transition: "transform 120ms" };
  }

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

  function saveEdit(values: { name: string; hex?: string; url?: string; unit?: string; photoTip?: string; prompt?: string; needs?: string }) {
    if (!editing) return;
    start(async () => {
      const res = await updateEntryAction(kind, editing.id, values);
      if (!res.ok) { setError(res.error); return; }
      patch(res.entry); setEditing(null); setError(undefined);
    });
  }

  const [deleteError, setDeleteError] = useState<string>();
  function doDelete() {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setDeleteError(undefined);
    start(async () => {
      const res = await deleteEntryAction(kind, target.id);
      if (!res.ok) { setDeleteError(res.error); return; } // stays open: the reason and the way out are right here
      setEntries((list) => list.filter((e) => e.id !== target.id)); setConfirmDelete(null); setError(undefined);
    });
  }

  const protectedCloset = (e: ListEntry) => kind === "closet" && e.closetKind !== "custom";

  return (
    <div className="space-y-4">
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <div className="flex items-center justify-between">
        <p className="mono mono-11 text-graphite">{active.length} {active.length === 1 ? def.singular : def.label.toLowerCase()}</p>
        <InlineAdd kind={kind} parentId={parentId} variant="primary" size="sm" onCreated={(e) => { setEntries((l) => [...l, e]); router.refresh(); }} />
      </div>

      {active.length > 12 ? <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find a ${def.singular}…`} aria-label={`Find a ${def.singular}`} data-testid="list-filter" /> : null}
      {filtering ? <p className="mono text-graphite">{shown.length} of {active.length} · clear the search to move rows</p> : null}

      <Card className="divide-y divide-line border-x-0 border-b-0 border-t border-ink p-0">
        {active.length === 0 ? <p className="mono py-6 text-center text-graphite">Nothing here yet · add the first one</p> : null}
        {shown.map((entry, i) => (
          <div key={entry.id} ref={(el) => { rowRefs.current[i] = el; }} style={dragStyle(i)} className={cn("flex items-center gap-1 py-1", pending && "opacity-70")} data-testid={`list-row-${entry.id}`}>
            {!filtering ? (
              <button type="button" aria-label={`Drag ${entry.name}`} title="Drag to reorder" onPointerDown={(e) => onGripDown(e, i)} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp}
                className="flex size-10 shrink-0 cursor-grab touch-none items-center justify-center text-graphite active:cursor-grabbing" data-testid={`grip-${entry.id}`}>
                <GripVertical className="size-4" strokeWidth={1.6} />
              </button>
            ) : null}
            {entry.hex ? <span className="size-6 shrink-0 border border-line" style={{ background: entry.hex }} aria-hidden /> : null}
            <button type="button" onClick={() => setEditing(entry)} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left">
              <span className="truncate text-[15px]">{entry.name}</span>
              {entry.closetKind && entry.closetKind !== "custom" ? <span className="mono text-graphite">{entry.closetKind}</span> : null}
              {entry.url ? <span className="mono truncate normal-case text-graphite">{entry.url.replace(/^https?:\/\//, "")}</span> : null}
              <Pencil className="ml-auto size-3.5 shrink-0 text-graphite" strokeWidth={1.6} aria-hidden />
            </button>
            <div className="flex shrink-0 items-center">
              <IconBtn label="Move up" disabled={filtering || i === 0} onClick={() => move(entry, -1)}><ArrowUp className="size-4" strokeWidth={1.6} /></IconBtn>
              <IconBtn label="Move down" disabled={filtering || i === active.length - 1} onClick={() => move(entry, 1)}><ArrowDown className="size-4" strokeWidth={1.6} /></IconBtn>
              {!protectedCloset(entry) ? (
                <>
                  <IconBtn label="Archive" onClick={() => toggleArchive(entry)}><Archive className="size-4" strokeWidth={1.6} /></IconBtn>
                  <IconBtn label="Delete" onClick={() => setConfirmDelete(entry)} danger><Trash2 className="size-4" strokeWidth={1.6} /></IconBtn>
                </>
              ) : null}
            </div>
          </div>
        ))}
      </Card>

      {archived.length > 0 ? (
        <details className="group">
          <summary className="mono mono-11 cursor-pointer select-none text-graphite">Archived ({archived.length})</summary>
          <Card className="mt-2 divide-y divide-line border-x-0 border-b-0 border-t border-ink p-0">
            {archived.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 py-1 text-graphite">
                <span className="flex-1 truncate py-2 text-[15px] line-through">{entry.name}</span>
                <IconBtn label="Restore" onClick={() => toggleArchive(entry)}><ArchiveRestore className="size-4" /></IconBtn>
                <IconBtn label="Delete" onClick={() => setConfirmDelete(entry)} danger><Trash2 className="size-4" strokeWidth={1.6} /></IconBtn>
              </div>
            ))}
          </Card>
        </details>
      ) : null}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={`Edit ${def.singular}`}>
        {editing ? <EditForm key={editing.id} entry={editing} kind={kind} onSave={saveEdit} pending={pending} /> : null}
      </Sheet>

      <Sheet open={!!confirmDelete} onClose={() => { setConfirmDelete(null); setDeleteError(undefined); }} title={`Delete “${confirmDelete?.name}”?`}>
        {deleteError ? (
          <div className="flex flex-col gap-4" data-testid="delete-in-use">
            <Banner tone="danger" title={deleteError} />
            <p className="text-[14px] leading-snug text-graphite">Archiving hides it from every list but keeps what already uses it.</p>
            <div className="flex gap-2">
              <button type="button" className="pill pill-quiet flex-1 h-[50px]" onClick={() => { setConfirmDelete(null); setDeleteError(undefined); }}>Keep</button>
              {confirmDelete && !protectedCloset(confirmDelete) && !confirmDelete.isArchived ? <button type="button" className="pill pill-solid flex-1 h-[50px]" disabled={pending} onClick={() => { toggleArchive(confirmDelete); setConfirmDelete(null); setDeleteError(undefined); }} data-testid="archive-instead">Archive instead</button> : null}
            </div>
          </div>
        ) : (
          <>
            <p className="text-[14px] leading-snug text-graphite">This can&apos;t be undone. If anything still uses it, the app stops you here and offers to archive instead.</p>
            <div className="mt-5 flex gap-2">
              <button type="button" className="pill pill-quiet flex-1 h-[50px]" onClick={() => setConfirmDelete(null)}>Keep</button>
              <Button variant="danger" className="flex-1" onClick={doDelete} disabled={pending}><Trash2 className="size-4" strokeWidth={1.6} /> Delete</Button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className={cn("flex size-11 items-center justify-center text-graphite active:text-ink disabled:opacity-30", danger && "active:text-ink")}>
      {children}
    </button>
  );
}

function EditForm({ entry, kind, onSave, pending }: { entry: ListEntry; kind: ListKind; onSave: (v: { name: string; hex?: string; url?: string; unit?: string; photoTip?: string; prompt?: string; needs?: string }) => void; pending: boolean }) {
  const def = LIST_DEFS[kind];
  const [name, setName] = useState(entry.name);
  const [extra, setExtra] = useState<{ hex?: string; url?: string; unit?: string; photoTip?: string; prompt?: string; needs?: string }>({ hex: entry.hex, url: entry.url ?? "", unit: entry.unit ?? "", photoTip: entry.photoTip ?? "", prompt: entry.prompt ?? "", needs: entry.needs ?? "" });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ name, ...extra }); }} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="edit-name" className="mono tracking-[0.14em] text-graphite">Name</label>
        <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={60} />
      </div>
      <EntryExtraFields fields={def.extraFields} values={extra} onChange={(p) => setExtra((x) => ({ ...x, ...p }))} />
      <Button type="submit" className="w-full" disabled={pending}>Save</Button>
    </form>
  );
}

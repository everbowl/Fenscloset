"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { InlineAdd } from "@/components/lists/inline-add";
import { UndoStrip, useUndoable } from "@/components/ui/undo-strip";
import { toast } from "@/components/ui/toast";
import type { ListRequestView } from "@/lib/lists/requests";
import { resolveRequestAction } from "./actions";

/** What the family asked for (J1): add it to its list in one tap, or dismiss it with five seconds to change your mind. */
export function ListRequests({ requests }: { requests: ListRequestView[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const undoable = useUndoable();
  const [hidden, setHidden] = useState<string[]>([]);
  const shown = requests.filter((r) => !hidden.includes(r.id));
  if (!requests.length) return null;
  // A row leaves the screen at once; if the server says no, it comes back with the error (review A W8).
  const resolve = (id: string, status: "added" | "dismissed") => start(async () => {
    const r = await resolveRequestAction(id, status);
    if (!r.ok) { setHidden((h) => h.filter((x) => x !== id)); toast.error(r.error); }
    router.refresh();
  });
  return (
    <section className="mb-6" data-testid="list-requests">
      <h2 className="section mb-2">Asked for · {shown.length}</h2>
      {undoable.pending ? <UndoStrip text={undoable.pending.text} onUndo={undoable.undo} testId="request-undo" className="mb-2" /> : null}
      <div className="card divide-y divide-line">
        {shown.map((r) => (
          <div key={r.id} className="flex min-h-[60px] items-center gap-3 px-4 py-2" data-testid="list-request">
            <span className="min-w-0 flex-1"><span className="block truncate text-[16px] font-medium">{r.name}</span><span className="caption block truncate">{r.kindLabel} · asked by {r.askedBy}</span></span>
            <InlineAdd kind={r.kind} parentId={r.parentId ?? undefined} initialName={r.name} label="Add" testId={`request-add-${r.id}`} onCreated={() => { setHidden((h) => [...h, r.id]); resolve(r.id, "added"); toast.ok(`${r.name} added`); }} />
            <button type="button" onClick={() => { setHidden((h) => [...h, r.id]); undoable.start(`Dismissed · ${r.name}`, () => resolve(r.id, "dismissed"), () => setHidden((h) => h.filter((x) => x !== r.id))); }} className="pill pill-sm pill-quiet" data-testid={`request-dismiss-${r.id}`}>Dismiss</button>
          </div>
        ))}
      </div>
    </section>
  );
}

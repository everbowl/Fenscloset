"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { ListEditor } from "@/components/lists/list-editor";
import { LinkPending } from "@/components/link-pending";
import type { ListEntry } from "@/lib/lists/service";

/** Closet category chips from the editable list (Alta's chip row), with a pencil at the end for admins. `keep` is every other URL parameter (the search, the sort, the filters), carried from chip to chip. */
export function FilterTabs({ categories, active, basePath, keep = {}, canEdit }: { categories: ListEntry[]; active?: string; basePath: string; keep?: Record<string, string>; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const href = (cat?: string) => {
    const p = new URLSearchParams(keep);
    if (cat) p.set("cat", cat); else p.delete("cat");
    const s = p.toString();
    return `${basePath}${s ? `?${s}` : ""}`;
  };
  const chip = (label: string, cat: string | undefined) => {
    const on = active === cat || (!active && !cat);
    return (
      <Link key={cat ?? "all"} href={href(cat)} aria-current={on ? "page" : undefined} className="pill pill-sm shrink-0">
        <LinkPending>{label}</LinkPending>
      </Link>
    );
  };
  return (
    <div className="strip -mx-5 items-center gap-2 px-5 py-1" data-testid="category-chips">
      {chip("All", undefined)}
      {categories.filter((c) => !c.isArchived).map((c) => chip(c.name, c.id))}
      {canEdit ? (
        <>
          <button type="button" onClick={() => setEditing(true)} aria-label="Edit categories" className="pill pill-sm pill-quiet shrink-0 px-2.5"><Pencil className="size-3.5" strokeWidth={2} /></button>
          <Sheet open={editing} onClose={() => setEditing(false)} title="Categories">
            <ListEditor kind="category" entries={categories} />
          </Sheet>
        </>
      ) : null}
    </div>
  );
}

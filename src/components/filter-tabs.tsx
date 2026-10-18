"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { ListEditor } from "@/components/lists/list-editor";
import { cn } from "@/lib/cn";
import type { ListEntry } from "@/lib/lists/service";

/** Closet category tabs from the editable list, with EDIT at the far right (admins edit in place). */
export function FilterTabs({ categories, active, basePath, q, canEdit }: { categories: ListEntry[]; active?: string; basePath: string; q?: string; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const href = (cat?: string) => `${basePath}${[cat ? `cat=${cat}` : null, q ? `q=${encodeURIComponent(q)}` : null].filter(Boolean).map((s, i) => (i ? "&" : "?") + s).join("")}`;
  const tab = (label: string, cat: string | undefined) => (
    <Link key={cat ?? "all"} href={href(cat)} aria-current={active === cat || (!active && !cat) ? "page" : undefined}
      className={cn("mono mono-11 shrink-0 py-2", active === cat || (!active && !cat) ? "border-b-[1.5px] border-ink text-ink" : "text-graphite")}>
      {label}
    </Link>
  );
  return (
    <div className="-mx-5 flex items-center gap-[18px] overflow-x-auto px-5 [scrollbar-width:none]">
      {tab("All", undefined)}
      {categories.filter((c) => !c.isArchived).map((c) => tab(c.name, c.id))}
      {canEdit ? (
        <>
          <button type="button" onClick={() => setEditing(true)} aria-label="Edit categories" className="mono mono-11 ml-auto shrink-0 py-2 text-ink">Edit</button>
          <Sheet open={editing} onClose={() => { setEditing(false); router.refresh(); }} title="Categories">
            <ListEditor kind="category" entries={categories} />
          </Sheet>
        </>
      ) : null}
    </div>
  );
}

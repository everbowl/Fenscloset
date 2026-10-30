"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { ListEditor } from "@/components/lists/list-editor";
import { cn } from "@/lib/cn";
import type { ListEntry } from "@/lib/lists/service";

/** Closet category tabs from the editable list, with EDIT at the far right (admins edit in place). `keep` is every other URL parameter (the search, the sort, the filters), carried from tab to tab. */
export function FilterTabs({ categories, active, basePath, keep = {}, canEdit }: { categories: ListEntry[]; active?: string; basePath: string; keep?: Record<string, string>; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const href = (cat?: string) => {
    const p = new URLSearchParams(keep);
    if (cat) p.set("cat", cat); else p.delete("cat");
    const s = p.toString();
    return `${basePath}${s ? `?${s}` : ""}`;
  };
  const tab = (label: string, cat: string | undefined) => (
    <Link key={cat ?? "all"} href={href(cat)} aria-current={active === cat || (!active && !cat) ? "page" : undefined}
      className={cn("mono mono-11 flex min-h-11 shrink-0 items-center", active === cat || (!active && !cat) ? "text-ink" : "text-graphite")}>
      <span className={cn("py-1", (active === cat || (!active && !cat)) && "border-b-[1.5px] border-ink")}>{label}</span>
    </Link>
  );
  return (
    <div className="-mx-5 flex items-center gap-[18px] overflow-x-auto px-5 [scrollbar-width:none]">
      {tab("All", undefined)}
      {categories.filter((c) => !c.isArchived).map((c) => tab(c.name, c.id))}
      {canEdit ? (
        <>
          <button type="button" onClick={() => setEditing(true)} aria-label="Edit categories" className="pill pill-sm ml-auto shrink-0">Edit</button>
          <Sheet open={editing} onClose={() => { setEditing(false); router.refresh(); }} title="Categories">
            <ListEditor kind="category" entries={categories} />
          </Sheet>
        </>
      ) : null}
    </div>
  );
}

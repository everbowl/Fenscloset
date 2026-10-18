import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ListEditor } from "@/components/lists/list-editor";
import { ParentPicker } from "@/components/lists/parent-picker";
import { LIST_DEFS, isListKind } from "@/lib/lists/registry";
import { listEntries } from "@/lib/lists/service";

export default async function ListKindPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ parent?: string }> }) {
  const { kind } = await params;
  if (!isListKind(kind)) notFound();
  const def = LIST_DEFS[kind];
  const { parent } = await searchParams;

  let parents: Awaited<ReturnType<typeof listEntries>> = [];
  let parentId: string | undefined;
  if (def.parent) {
    parents = await listEntries(def.parent.kind);
    parentId = parent && parents.some((p) => p.id === parent) ? parent : parents[0]?.id;
  }
  const entries = await listEntries(kind, { parentId, includeArchived: true });

  return (
    <div>
      <Link href="/admin/lists" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"><ChevronLeft className="size-4" /> All lists</Link>
      <PageHeader title={def.label} subtitle={def.description} />
      {def.parent ? <ParentPicker label={def.parent.label} kind={kind} parents={parents} selected={parentId} /> : null}
      <ListEditor key={`${kind}:${parentId ?? ""}`} kind={kind} entries={entries} parentId={parentId} />
    </div>
  );
}

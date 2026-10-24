import { notFound } from "next/navigation";
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
      <PageHeader title={def.label} />
      <p className="-mt-2 mb-4 text-[13px] leading-snug text-graphite">{def.description}</p>
      {def.parent ? <ParentPicker label={def.parent.label} kind={kind} parents={parents} selected={parentId} /> : null}
      <ListEditor key={`${kind}:${parentId ?? ""}`} kind={kind} entries={entries} parentId={parentId} />
    </div>
  );
}

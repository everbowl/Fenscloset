import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { LIST_DEFS, LIST_KINDS } from "@/lib/lists/registry";
import { countAll } from "@/lib/lists/service";

export const metadata = { title: "Lists" };

export default async function ListsOverviewPage() {
  const counts = await countAll();
  return (
    <div>
      <PageHeader title="Lists" aside={`${LIST_KINDS.length} lists`} />
      <p className="mb-2 text-[14px] leading-snug text-graphite">Everything the app uses to describe clothes. Edit, add, reorder, archive, or delete any of it.</p>
      <div className="border-t border-ink">
        {LIST_KINDS.map((kind) => {
          const def = LIST_DEFS[kind];
          return (
            <Link key={kind} href={`/admin/lists/${kind}`} className="flex items-center gap-3 border-b border-line py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium">{def.label}</p>
                <p className="truncate text-[13px] text-graphite">{def.description}</p>
              </div>
              <span className="mono mono-11 text-graphite">{counts[kind]}</span>
              <span className="mono text-graphite">→</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

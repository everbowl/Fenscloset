import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { LIST_DEFS, LIST_KINDS } from "@/lib/lists/registry";
import { countAll } from "@/lib/lists/service";

export const metadata = { title: "Lists" };

export default async function ListsOverviewPage() {
  const counts = await countAll();
  return (
    <div>
      <PageHeader title="Lists" subtitle="Everything the app uses to describe clothes. Edit, add, reorder, or delete any of it." />
      <Card className="divide-y divide-border p-0">
        {LIST_KINDS.map((kind) => {
          const def = LIST_DEFS[kind];
          return (
            <Link key={kind} href={`/admin/lists/${kind}`} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium">{def.label}</p>
                <p className="truncate text-sm text-muted">{def.description}</p>
              </div>
              <span className="text-sm text-muted">{counts[kind]}</span>
              <ChevronRight className="size-4 text-stone-400" />
            </Link>
          );
        })}
      </Card>
    </div>
  );
}

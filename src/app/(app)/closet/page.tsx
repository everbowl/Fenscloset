import Link from "next/link";
import { requirePerson, isAdmin } from "@/lib/auth/current";
import { PageHeader } from "@/components/ui/page-header";
import { listEntries } from "@/lib/lists/service";

export const metadata = { title: "Closet" };

export default async function ClosetPage() {
  const person = await requirePerson();
  const categories = await listEntries("category");
  return (
    <div>
      <PageHeader title="Closet" aside="0 pieces" />
      <div className="-mx-5 flex items-center gap-[18px] overflow-x-auto px-5 mono mono-11">
        <span className="shrink-0 border-b-[1.5px] border-ink py-2">All</span>
        {categories.map((c) => <span key={c.id} className="shrink-0 py-2 text-graphite">{c.name}</span>)}
        {isAdmin(person) ? <Link href="/admin/lists/category" aria-label="Edit categories" className="ml-auto shrink-0 py-2 text-ink">Edit</Link> : null}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-2.5 gap-y-[18px]">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="h-[214px] bg-bone" />
            <div className="h-3 w-24 bg-bone" />
          </div>
        ))}
      </div>
      <p className="mono mt-6 text-center text-graphite">Nothing here yet · tap + to add clothes</p>
    </div>
  );
}

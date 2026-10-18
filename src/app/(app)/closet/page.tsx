import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { requirePerson, isAdmin } from "@/lib/auth/current";
import { PageHeader } from "@/components/ui/page-header";
import { listEntries } from "@/lib/lists/service";
import { resolveView, VIEW_COOKIE } from "@/lib/people/visibility";
import { countClosetItems, listClosetItems } from "@/lib/items/query";
import { ItemCard } from "@/components/item-card";
import { FilterTabs } from "@/components/filter-tabs";
import { ClosetSearch } from "@/components/closet-search";

export const metadata = { title: "Closet" };
export const dynamic = "force-dynamic";

export default async function ClosetPage({ searchParams }: { searchParams: Promise<{ cat?: string; q?: string }> }) {
  const person = await requirePerson();
  const { cat, q } = await searchParams;
  const view = await resolveView(person, (await cookies()).get(VIEW_COOKIE)?.value);
  const categories = await listEntries("category", { includeArchived: true });
  const categoryId = cat && categories.some((c) => c.id === cat) ? cat : undefined;
  const [items, total] = await Promise.all([listClosetItems(view, { categoryId, q }), countClosetItems(view)]);
  const mine = view.kind === "person" && view.personId === person.id;

  return (
    <div>
      <Suspense><ClosetSearch basePath="/closet" /></Suspense>
      <PageHeader title={view.kind === "family" ? "Family" : mine ? "Closet" : view.name} accent={view.kind === "family" ? "closet" : mine ? undefined : "closet"} aside={`${total} ${total === 1 ? "piece" : "pieces"}`} />
      <FilterTabs categories={categories} active={categoryId} basePath="/closet" q={q} canEdit={isAdmin(person)} />
      {items.length ? (
        <div className="mt-4 grid grid-cols-2 gap-x-2.5 gap-y-[18px] lg:grid-cols-4 lg:gap-x-4 lg:gap-y-7">
          {items.map((it) => <ItemCard key={it.id} item={it} showOwner={view.kind === "family"} />)}
        </div>
      ) : (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-x-2.5 gap-y-[18px]">
            {[0, 1].map((i) => <div key={i} className="flex flex-col gap-2"><div className="h-[214px] bg-bone" /><div className="h-3 w-24 bg-bone" /></div>)}
          </div>
          <p className="mono mt-6 text-center text-graphite">
            {q ? `Nothing matches “${q}”` : total === 0 ? (mine ? "Nothing here yet · tap + to add clothes" : "Nothing here yet") : "Nothing in this category"}
          </p>
          {mine && total === 0 ? <div className="mt-4 text-center"><Link href="/add" className="mono mono-11 inline-block border border-ink px-5 py-3.5">Add clothes</Link></div> : null}
        </div>
      )}
    </div>
  );
}

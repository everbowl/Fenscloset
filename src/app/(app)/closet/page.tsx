import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { requirePerson, isAdmin } from "@/lib/auth/current";
import { PageHeader } from "@/components/ui/page-header";
import { listEntries } from "@/lib/lists/service";
import { resolveView, VIEW_COOKIE } from "@/lib/people/visibility";
import { loadClosetView } from "@/lib/items/query";
import { activeFilterCount, closetQuery, parseClosetParams } from "@/lib/items/views";
import { mirrorConfig } from "@/lib/tryon/config";
import { FilterTabs } from "@/components/filter-tabs";
import { ClosetSearch } from "@/components/closet-search";
import { RememberCloset } from "@/components/remember-closet";
import { ClosetGrid } from "./closet-grid";
import { ClosetTools } from "./closet-tools";
import { ClosetPickProvider } from "./pick-context";
import { countCleanOut } from "@/lib/outfits/cleanout";

export const metadata = { title: "Closet" };
export const dynamic = "force-dynamic";

export default async function ClosetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const person = await requirePerson();
  const sp = await searchParams;
  const cat = typeof sp.cat === "string" ? sp.cat : undefined;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const { filters, sort } = parseClosetParams(sp);
  const view = await resolveView(person, (await cookies()).get(VIEW_COOKIE)?.value);
  const categories = await listEntries("category", { includeArchived: true });
  const categoryId = cat && categories.some((c) => c.id === cat) ? cat : undefined;
  const { items, shown, total, facets, toggles } = await loadClosetView(view, { categoryId, q, filters, sort });
  const mine = view.kind === "person" && view.personId === person.id;
  // The mirror's pick mode: from your own closet or the Family closet, the pieces go on you (or the mannequin).
  const mirror = mine || view.kind === "family" ? await mirrorConfig(person) : null;
  const canMirror = Boolean(mirror && (mirror.tryOn === "ready" || mirror.mannequinAvailable));
  const cleanOut = mine ? await countCleanOut(person.id) : 0;
  const filtered = activeFilterCount(filters) > 0;
  const narrowed = Boolean(categoryId || q || filtered);
  // Everything but the category rides along when a tab changes: the search, the sort, the filters.
  const keep = Object.fromEntries(Object.entries(sp).filter(([k, v]) => k !== "cat" && typeof v === "string")) as Record<string, string>;

  return (
    <div>
      <Suspense><ClosetSearch basePath="/closet" /><RememberCloset /></Suspense>
      <PageHeader title={view.kind === "family" ? "Family" : mine ? "Closet" : view.name} accent={view.kind === "family" ? "closet" : mine ? undefined : "closet"}
        aside={narrowed ? `${shown} of ${total} ${total === 1 ? "piece" : "pieces"}` : `${total} ${total === 1 ? "piece" : "pieces"}`} />
      <FilterTabs categories={categories} active={categoryId} basePath="/closet" keep={keep} canEdit={isAdmin(person)} />
      <ClosetPickProvider>
      <ClosetTools basePath="/closet" filters={filters} sort={sort} facets={facets} toggles={toggles} shown={shown} total={total} cat={categoryId} q={q} mirror={canMirror && items.length > 0} cleanOut={cleanOut} />
      {items.length ? (
        <ClosetGrid items={items} showOwner={view.kind === "family"} mirror={mirror} />
      ) : (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-x-2.5 gap-y-[18px]">
            {[0, 1].map((i) => <div key={i} className="flex flex-col gap-2"><div className="h-[214px] bg-bone" /><div className="h-3 w-24 bg-bone" /></div>)}
          </div>
          <p className="mono mt-6 text-center text-graphite" data-testid="closet-empty">
            {q ? `Nothing matches “${q}”` : filtered ? "Nothing matches these filters" : total === 0 ? (mine ? "Nothing here yet · tap + to add clothes" : "Nothing here yet") : "Nothing in this category"}
          </p>
          {q ? <div className="mt-4 text-center"><Link href={`/closet${closetQuery({ sort, cat: categoryId, filters })}`} className="pill" data-testid="empty-clear-search">Clear search</Link></div>
            : filtered ? <div className="mt-4 text-center"><Link href={`/closet${closetQuery({ sort, cat: categoryId, q })}`} className="pill" data-testid="empty-clear-filters">Clear filters</Link></div>
            : categoryId && total > 0 ? <div className="mt-4 text-center"><Link href={`/closet${closetQuery({ sort, q, filters })}`} className="pill" data-testid="empty-see-all">See all {total}</Link></div> : null}
          {mine && total === 0 ? <div className="mt-4 text-center"><Link href="/add" className="pill pill-solid h-[50px] px-6">Add clothes</Link></div> : null}
        </div>
      )}
      </ClosetPickProvider>
    </div>
  );
}

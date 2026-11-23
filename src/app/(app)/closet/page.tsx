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
import { listNeeds } from "@/lib/closet/needs";
import { bodyViewerNames } from "@/lib/profiles/service";
import { likelySizes, sizeOptionsByCategory } from "@/lib/profiles/sizes";
import { NeedsStrip } from "./needs-strip";
import { LookTray } from "@/components/looks/look-tray";
import { pendingAdds } from "@/lib/import/pending";
import { AddedToast, TaggingCards } from "./tagging-cards";

export const metadata = { title: "Closet" };
export const dynamic = "force-dynamic";

export default async function ClosetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const person = await requirePerson();
  const sp = await searchParams;
  const cat = typeof sp.cat === "string" ? sp.cat : undefined;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const added = typeof sp.added === "string" ? Number(sp.added) || 0 : 0;
  const { filters, sort } = parseClosetParams(sp);
  // The independent loads run side by side (review B C1): this page used to be eight round trips in a row.
  const [view, categories] = await Promise.all([resolveView(person, (await cookies()).get(VIEW_COOKIE)?.value), listEntries("category", { includeArchived: true })]);
  const categoryId = cat && categories.some((c) => c.id === cat) ? cat : undefined;
  const mine = view.kind === "person" && view.personId === person.id;
  const [{ items, shown, total, facets, toggles }, mirror, cleanOut, needs, pending] = await Promise.all([
    loadClosetView(view, { categoryId, q, filters, sort }),
    // The mirror's pick mode: from your own closet or the Family closet, the pieces go on you (or the mannequin).
    mine || view.kind === "family" ? mirrorConfig(person) : null,
    mine ? countCleanOut(person.id) : 0,
    // What's needed (D1): the owner's own closet only; the rows' sheets get their lists only when a row needs them.
    mine ? listNeeds(person, person.id) : [],
    // Just added and not a card yet (Tagging, failed, waiting to confirm, needs a category): in every view of the owner's own closet (review B A2.3), narrowed by category only where the category is known.
    mine ? pendingAdds(person.id, { categoryId }) : null,
  ]);
  const canMirror = Boolean(mirror && (mirror.tryOn === "ready" || mirror.mannequinAvailable));
  const [sections, sizeOptions, likely, visibleTo] = await Promise.all([
    needs.some((n) => n.kind === "section") ? listEntries("shopSection") : [],
    needs.some((n) => n.kind === "size") ? sizeOptionsByCategory() : [],
    needs.some((n) => n.kind === "size") ? likelySizes(person.id) : null,
    needs.some((n) => n.view) ? bodyViewerNames(person.id) : [],
  ]);
  const filtered = activeFilterCount(filters) > 0;
  const narrowed = Boolean(categoryId || q || filtered);
  const lead = pending && (pending.cards.length || pending.toConfirm) ? <TaggingCards pending={pending} /> : null;
  // A piece shown as a "Needs a category" card is not shown a second time as a plain tile.
  const pendingItemIds = new Set((pending?.cards ?? []).map((c) => c.itemId).filter((id): id is string => Boolean(id)));
  const tiles = pendingItemIds.size ? items.filter((it) => !pendingItemIds.has(it.id)) : items;
  // Everything but the category rides along when a tab changes: the search, the sort, the filters.
  const keep = Object.fromEntries(Object.entries(sp).filter(([k, v]) => k !== "cat" && k !== "added" && typeof v === "string")) as Record<string, string>;

  return (
    <div>
      <Suspense><ClosetSearch basePath="/closet" /><RememberCloset /></Suspense>
      {added > 0 ? <AddedToast count={added} /> : null}
      <PageHeader title={view.kind === "family" ? "Family" : mine ? "Closet" : view.name} accent={view.kind === "family" ? "closet" : mine ? undefined : "closet"}
        aside={narrowed ? `${shown} of ${total} ${total === 1 ? "piece" : "pieces"}` : `${total} ${total === 1 ? "piece" : "pieces"}`} />
      <FilterTabs categories={categories} active={categoryId} basePath="/closet" keep={keep} canEdit={isAdmin(person)} />
      <ClosetPickProvider>
      <ClosetTools basePath="/closet" filters={filters} sort={sort} facets={facets} toggles={toggles} shown={shown} total={total} cat={categoryId} q={q} mirror={canMirror && items.length > 0} cleanOut={cleanOut} />
      {needs.length ? <NeedsStrip personId={person.id} needs={needs} sections={sections} isAdmin={isAdmin(person)} sizeOptions={sizeOptions} likely={likely} visibleTo={visibleTo} /> : null}
      {tiles.length || lead ? (
        <div id="just-added"><ClosetGrid items={tiles} showOwner={view.kind === "family"} mirror={mirror} lead={lead} /></div>
      ) : (
        <div className="mt-3">
          <div className="grid grid-cols-3 gap-x-2 gap-y-4">
            {[0, 1, 2].map((i) => <div key={i} className="flex flex-col gap-2"><div className="stage aspect-[4/5] rounded-xl" /><div className="h-3 w-16 rounded bg-bone" /></div>)}
          </div>
          <p className="note mt-6 text-center" data-testid="closet-empty">
            {q ? `Nothing matches “${q}”` : filtered ? "Nothing matches these filters" : total === 0 ? (mine ? "Nothing here yet · tap + to add clothes" : "Nothing here yet") : "Nothing in this category"}
          </p>
          {q ? <div className="mt-4 text-center"><Link href={`/closet${closetQuery({ sort, cat: categoryId, filters })}`} className="pill" data-testid="empty-clear-search">Clear search</Link></div>
            : filtered ? <div className="mt-4 text-center"><Link href={`/closet${closetQuery({ sort, cat: categoryId, q })}`} className="pill" data-testid="empty-clear-filters">Clear filters</Link></div>
            : categoryId && total > 0 ? <div className="mt-4 text-center"><Link href={`/closet${closetQuery({ sort, q, filters })}`} className="pill" data-testid="empty-see-all">See all {total}</Link></div> : null}
          {mine && total === 0 ? <div className="mt-4 text-center"><Link href="/add" className="pill pill-solid h-12 px-6 text-[15px]">Add clothes</Link></div> : null}
        </div>
      )}
      </ClosetPickProvider>
      {mine ? <LookTray personId={person.id} /> : null}
    </div>
  );
}

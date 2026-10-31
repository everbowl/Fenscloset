import { db } from "@/lib/db";
import type { ClosetView } from "@/lib/people/visibility";
import type { LaundryStatus } from "@/generated/prisma/client";
import { applyFilters, facetCounts, sortItems, toggleCounts, FACET_KEYS, FACET_LABEL, STATUS_OPTIONS, type ClosetFilters, type ClosetSort, type FacetKey, type Toggle, type ViewItem } from "@/lib/items/views";

export type ItemCardData = {
  id: string;
  name: string;
  thumbKey: string | null;
  categoryName: string | null;
  status: string;
  ownerId: string;
  ownerName: string;
};

export function statusWord(it: { laundryStatus: LaundryStatus; wearCount: number }): string {
  if (it.laundryStatus === "dirty") return "In the wash";
  if (it.laundryStatus === "cleaners") return "At cleaners";
  if (it.wearCount > 0) return `Worn ${it.wearCount}×`;
  return "New";
}

const cardSelect = {
  id: true, name: true, ownerId: true, laundryStatus: true, wearCount: true,
  owner: { select: { name: true } },
  category: { select: { name: true } },
  photos: { where: { kind: "thumb" as const }, take: 1, select: { bucketKey: true } },
};

/** Grid data for a closet view, newest first. `q` matches name or brand. */
export async function listClosetItems(view: ClosetView, opts: { categoryId?: string; q?: string } = {}): Promise<ItemCardData[]> {
  const q = opts.q?.trim();
  const items = await db.item.findMany({
    where: {
      ...(view.kind === "family" ? { closets: { some: { closet: { kind: "family" } } } } : { ownerId: view.personId }),
      retiredAt: null,
      ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { brand: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: cardSelect,
  });
  return items.map((it) => ({
    id: it.id, name: it.name ?? "Untitled piece", thumbKey: it.photos[0]?.bucketKey ?? null, categoryName: it.category?.name ?? null,
    status: statusWord(it), ownerId: it.ownerId, ownerName: it.owner.name.split(" ")[0],
  }));
}

export async function countClosetItems(view: ClosetView): Promise<number> {
  return db.item.count({ where: { retiredAt: null, ...(view.kind === "family" ? { closets: { some: { closet: { kind: "family" } } } } : { ownerId: view.personId }) } });
}

export async function getItemDetail(itemId: string) {
  return db.item.findUnique({
    where: { id: itemId },
    include: {
      owner: { select: { id: true, name: true, role: true } },
      category: true, subcategory: true, brand: true, store: true,
      colors: true, patterns: true, fabrics: true, seasons: true, formalities: true, occasions: true, tags: true,
      photos: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      closets: { include: { closet: true } },
      shares: { include: { person: { select: { id: true, name: true } } } },
    },
  });
}
export type ItemDetail = NonNullable<Awaited<ReturnType<typeof getItemDetail>>>;

import { loadTagLists, type Named, type TagLists } from "@/lib/ai/tag-item";

export type ItemLists = TagLists & { occasions: Named[]; tags: Named[]; stores: Named[]; closets: (Named & { kind: "family" | "custom" })[]; people: Named[] };

/** Everything the item editor's rows can pick from. */
export async function loadItemLists(viewerId: string): Promise<ItemLists> {
  const sel = { id: true, name: true } as const;
  const [tagLists, occasions, tags, stores, closets, people] = await Promise.all([
    loadTagLists(),
    db.occasion.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: sel }),
    db.tag.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: sel }),
    db.store.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: sel }),
    db.closet.findMany({ where: { isArchived: false, kind: { in: ["family", "custom"] } }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }], select: { id: true, name: true, kind: true } }),
    db.person.findMany({ where: { status: { not: "removed" }, NOT: { id: viewerId } }, orderBy: { createdAt: "asc" }, select: sel }),
  ]);
  return { ...tagLists, occasions, tags, stores, closets: closets.map((c) => ({ id: c.id, name: c.name, kind: c.kind as "family" | "custom" })), people: people.map((p) => ({ id: p.id, name: p.name.split(" ")[0] })) };
}

// ---------- Closet views: filters and sorts (Shop v2 item 5) ----------

export type FacetOption = { id: string; name: string; count: number; /** a color's swatch */ hex?: string };
export type Facet = { key: FacetKey; label: string; options: FacetOption[] };
export type ClosetViewData = {
  items: ItemCardData[];
  /** pieces after the category, the search and the filters */ shown: number;
  /** every piece in the view */ total: number;
  /** the facets worth showing: an option appears when it would show something, or is picked */ facets: Facet[];
  toggles: Record<Toggle, number>;
};

const viewSelect = {
  ...cardSelect,
  brandId: true, isFavorite: true, lastWornAt: true, createdAt: true, purchasePrice: true,
  colors: { select: { id: true } }, seasons: { select: { id: true } }, occasions: { select: { id: true } }, formalities: { select: { id: true } },
  fabrics: { select: { id: true } }, patterns: { select: { id: true } }, tags: { select: { id: true } }, closets: { select: { closetId: true } },
};

type FacetEntry = { id: string; name: string; hex?: string };
const sel = { id: true, name: true } as const;
const live = (where: object = {}) => ({ where: { isArchived: false, ...where }, orderBy: { sortOrder: "asc" as const } });

/** The editable lists a filter can pick from, in their list order. Closets: the Family closet and any extra one (Storage…), never a personal closet. */
async function loadFacetLists(): Promise<Record<Exclude<FacetKey, "status" | "closet">, FacetEntry[]> & { closet: (FacetEntry & { kind: string })[] }> {
  const [color, brand, season, occasion, formality, fabric, pattern, tag, closet] = await Promise.all([
    db.color.findMany({ ...live(), select: { ...sel, hex: true } }),
    db.brand.findMany({ ...live(), select: sel }),
    db.season.findMany({ ...live(), select: sel }),
    db.occasion.findMany({ ...live(), select: sel }),
    db.formalityLevel.findMany({ ...live(), select: sel }),
    db.fabric.findMany({ ...live(), select: sel }),
    db.pattern.findMany({ ...live(), select: sel }),
    db.tag.findMany({ ...live(), select: sel }),
    db.closet.findMany({ where: { isArchived: false, kind: { in: ["family", "custom"] } }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }], select: { ...sel, kind: true } }),
  ]);
  return { color, brand, season, occasion, formality, fabric, pattern, tag, closet };
}

/**
 * The closet grid for a view: the category tab and the search narrow it in the database, the filters and the sort
 * run here (a family's closet is a few hundred pieces), and every facet's counts come back for the filter sheet.
 */
export async function loadClosetView(view: ClosetView, opts: { categoryId?: string; q?: string; filters: ClosetFilters; sort: ClosetSort }): Promise<ClosetViewData> {
  const q = opts.q?.trim();
  const [rows, total, lists] = await Promise.all([
    db.item.findMany({
      where: {
        ...(view.kind === "family" ? { closets: { some: { closet: { kind: "family" } } } } : { ownerId: view.personId }),
        retiredAt: null,
        ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { brand: { name: { contains: q, mode: "insensitive" } } }] } : {}),
      },
      select: viewSelect,
    }),
    countClosetItems(view),
    loadFacetLists(),
  ]);
  const all: ViewItem[] = rows.map((it) => ({
    id: it.id, name: it.name ?? "Untitled piece", thumbKey: it.photos[0]?.bucketKey ?? null, categoryName: it.category?.name ?? null,
    status: statusWord(it), ownerId: it.ownerId, ownerName: it.owner.name.split(" ")[0],
    colorIds: it.colors.map((x) => x.id), brandId: it.brandId, seasonIds: it.seasons.map((x) => x.id), occasionIds: it.occasions.map((x) => x.id),
    formalityIds: it.formalities.map((x) => x.id), fabricIds: it.fabrics.map((x) => x.id), patternIds: it.patterns.map((x) => x.id), tagIds: it.tags.map((x) => x.id),
    closetIds: it.closets.map((x) => x.closetId), laundryStatus: it.laundryStatus, isFavorite: it.isFavorite, wearCount: it.wearCount, lastWornAt: it.lastWornAt,
    createdAt: it.createdAt, price: it.purchasePrice === null ? null : Number(it.purchasePrice),
  }));
  const kept = sortItems(applyFilters(all, opts.filters), opts.sort);
  const facets: Facet[] = [];
  for (const key of FACET_KEYS) {
    const counts = facetCounts(all, opts.filters, key);
    // in the Family closet view every piece is in the Family closet: that option would say nothing
    const entries: FacetEntry[] = key === "status" ? STATUS_OPTIONS : key === "closet" && view.kind === "family" ? lists.closet.filter((c) => c.kind !== "family") : lists[key];
    const options = entries
      .filter((o) => (counts.get(o.id) ?? 0) > 0 || opts.filters[key].includes(o.id))
      .map((o) => ({ id: o.id, name: o.name, count: counts.get(o.id) ?? 0, ...(o.hex ? { hex: o.hex } : {}) }));
    if (options.length) facets.push({ key, label: FACET_LABEL[key], options });
  }
  return {
    items: kept.map(({ id, name, thumbKey, categoryName, status, ownerId, ownerName }) => ({ id, name, thumbKey, categoryName, status, ownerId, ownerName })),
    shown: kept.length, total, facets, toggles: toggleCounts(all, opts.filters),
  };
}

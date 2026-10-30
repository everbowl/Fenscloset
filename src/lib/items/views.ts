import type { ItemCardData } from "@/lib/items/query";
import type { LaundryStatus } from "@/generated/prisma/client";

/**
 * Closet views (Shop v2 item 5; Jeff, 28 Oct 2026: "C", filters and sorts). Client-safe: what a filter is, how
 * it lives in the URL, which pieces it keeps, how a sort orders them, and the counts the filter sheet shows.
 * Every facet comes from an editable list (Admin → Lists), so nothing here names a color or a season.
 */

export const FACET_KEYS = ["color", "brand", "season", "occasion", "formality", "fabric", "pattern", "tag", "closet", "status"] as const;
export type FacetKey = (typeof FACET_KEYS)[number];
export const FACET_LABEL: Record<FacetKey, string> = {
  color: "Color", brand: "Brand", season: "Season", occasion: "Occasion", formality: "Formality", fabric: "Fabric", pattern: "Pattern", tag: "Tag", closet: "Closet", status: "Where it is",
};
/** The laundry words, keyed by the status the piece carries. */
export const STATUS_OPTIONS: { id: LaundryStatus; name: string }[] = [
  { id: "clean", name: "Clean" }, { id: "dirty", name: "In the wash" }, { id: "cleaners", name: "At cleaners" },
];

export type ClosetFilters = Record<FacetKey, string[]> & { favorites: boolean; unworn: boolean };
export type Toggle = "favorites" | "unworn";
export const TOGGLE_LABEL: Record<Toggle, string> = { favorites: "Favorites", unworn: "Never worn" };

export const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "recent", label: "Worn most recently" },
  { value: "forgotten", label: "Not worn the longest" },
  { value: "most-worn", label: "Worn the most" },
  { value: "least-worn", label: "Worn the least" },
  { value: "name", label: "Name, A to Z" },
  { value: "price-high", label: "Price, high to low" },
  { value: "price-low", label: "Price, low to high" },
] as const;
export type ClosetSort = (typeof SORTS)[number]["value"];
export const DEFAULT_SORT: ClosetSort = "newest";
export const sortLabel = (s: ClosetSort) => SORTS.find((x) => x.value === s)?.label ?? SORTS[0].label;

/** A piece with everything a filter or a sort looks at. */
export type ViewItem = ItemCardData & {
  colorIds: string[]; brandId: string | null; seasonIds: string[]; occasionIds: string[]; formalityIds: string[]; fabricIds: string[]; patternIds: string[]; tagIds: string[]; closetIds: string[];
  laundryStatus: LaundryStatus; isFavorite: boolean; wearCount: number; lastWornAt: Date | null; createdAt: Date; price: number | null;
};

export function emptyFilters(): ClosetFilters {
  return { color: [], brand: [], season: [], occasion: [], formality: [], fabric: [], pattern: [], tag: [], closet: [], status: [], favorites: false, unworn: false };
}

export function activeFilterCount(f: ClosetFilters): number {
  return FACET_KEYS.reduce((n, k) => n + f[k].length, 0) + Number(f.favorites) + Number(f.unworn);
}

const ON = new Set(["1", "true", "on", "yes"]);
type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The view a URL asks for: ?color=a,b&season=c&status=dirty&fav=1&unworn=1&sort=most-worn. Unknown sorts fall back to newest. */
export function parseClosetParams(sp: Params): { filters: ClosetFilters; sort: ClosetSort } {
  const filters = emptyFilters();
  for (const k of FACET_KEYS) filters[k] = [...new Set(one(sp[k]).split(",").map((s) => s.trim()).filter(Boolean))];
  filters.favorites = ON.has(one(sp.fav).toLowerCase());
  filters.unworn = ON.has(one(sp.unworn).toLowerCase());
  const s = one(sp.sort);
  const sort = SORTS.some((x) => x.value === s) ? (s as ClosetSort) : DEFAULT_SORT;
  return { filters, sort };
}

/** The URL for a view: "" when it is the plain closet. `cat` and `q` ride along. */
export function closetQuery(opts: { filters?: Partial<ClosetFilters>; sort?: ClosetSort; cat?: string; q?: string }): string {
  const p = new URLSearchParams();
  if (opts.cat) p.set("cat", opts.cat);
  if (opts.q) p.set("q", opts.q);
  const f = { ...emptyFilters(), ...opts.filters };
  for (const k of FACET_KEYS) if (f[k].length) p.set(k, f[k].join(","));
  if (f.favorites) p.set("fav", "1");
  if (f.unworn) p.set("unworn", "1");
  if (opts.sort && opts.sort !== DEFAULT_SORT) p.set("sort", opts.sort);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** What a piece carries for a facet. */
export const facetIds: Record<FacetKey, (it: ViewItem) => string[]> = {
  color: (it) => it.colorIds, brand: (it) => (it.brandId ? [it.brandId] : []), season: (it) => it.seasonIds, occasion: (it) => it.occasionIds, formality: (it) => it.formalityIds,
  fabric: (it) => it.fabricIds, pattern: (it) => it.patternIds, tag: (it) => it.tagIds, closet: (it) => it.closetIds, status: (it) => [it.laundryStatus],
};

/** Every facet is AND-ed; inside one, any of its picks will do. `except` leaves one facet or toggle out (for its own counts). */
export function matches(it: ViewItem, f: ClosetFilters, except?: FacetKey | Toggle): boolean {
  for (const k of FACET_KEYS) {
    if (k === except || !f[k].length) continue;
    const ids = facetIds[k](it);
    if (!f[k].some((id) => ids.includes(id))) return false;
  }
  if (f.favorites && except !== "favorites" && !it.isFavorite) return false;
  if (f.unworn && except !== "unworn" && it.wearCount > 0) return false;
  return true;
}

export function applyFilters<T extends ViewItem>(items: T[], f: ClosetFilters): T[] {
  return items.filter((it) => matches(it, f));
}

/** How many pieces each option of a facet would show, given every other filter (so a picked color never hides its siblings). */
export function facetCounts(items: ViewItem[], f: ClosetFilters, key: FacetKey): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) {
    if (!matches(it, f, key)) continue;
    for (const id of facetIds[key](it)) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

export function toggleCounts(items: ViewItem[], f: ClosetFilters): Record<Toggle, number> {
  let favorites = 0, unworn = 0;
  for (const it of items) {
    if (it.isFavorite && matches(it, f, "favorites")) favorites++;
    if (it.wearCount === 0 && matches(it, f, "unworn")) unworn++;
  }
  return { favorites, unworn };
}

const time = (d: Date | null) => (d ? d.getTime() : null);
const byName = (a: ViewItem, b: ViewItem) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
/** Nulls last, whichever direction. */
function nullsLast(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * dir;
}

/** A sorted copy. Ties fall back to newest first, then the name, so the order never jumps between visits. */
export function sortItems<T extends ViewItem>(items: T[], sort: ClosetSort): T[] {
  const newest = (a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime() || byName(a, b);
  const cmp: Record<ClosetSort, (a: T, b: T) => number> = {
    newest,
    oldest: (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || byName(a, b),
    recent: (a, b) => nullsLast(time(a.lastWornAt), time(b.lastWornAt), -1) || newest(a, b),
    // never worn is the most forgotten (the oldest of those first), then the longest since a wear
    forgotten: (a, b) => (a.lastWornAt === null) === (b.lastWornAt === null)
      ? (a.lastWornAt === null ? a.createdAt.getTime() - b.createdAt.getTime() || byName(a, b) : a.lastWornAt!.getTime() - b.lastWornAt!.getTime() || newest(a, b))
      : a.lastWornAt === null ? -1 : 1,
    "most-worn": (a, b) => b.wearCount - a.wearCount || nullsLast(time(a.lastWornAt), time(b.lastWornAt), -1) || newest(a, b),
    "least-worn": (a, b) => a.wearCount - b.wearCount || newest(a, b),
    name: (a, b) => byName(a, b) || newest(a, b),
    "price-high": (a, b) => nullsLast(a.price, b.price, -1) || newest(a, b),
    "price-low": (a, b) => nullsLast(a.price, b.price, 1) || newest(a, b),
  };
  return [...items].sort(cmp[sort]);
}

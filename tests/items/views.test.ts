import { describe, expect, it } from "vitest";
import { activeFilterCount, applyFilters, closetQuery, emptyFilters, facetCounts, parseClosetParams, sortItems, toggleCounts, type ViewItem } from "@/lib/items/views";

const day = 86400000;
const t0 = new Date("2026-10-01T00:00:00Z");
const at = (d: number) => new Date(t0.getTime() + d * day);
const piece = (id: string, o: Partial<ViewItem> = {}): ViewItem => ({
  id, name: id, thumbKey: null, categoryName: "Tops", status: "New", ownerId: "jeff", ownerName: "Jeff",
  colorIds: [], brandId: null, seasonIds: [], occasionIds: [], formalityIds: [], fabricIds: [], patternIds: [], tagIds: [], closetIds: [],
  laundryStatus: "clean", isFavorite: false, wearCount: 0, lastWornAt: null, createdAt: t0, price: null, ...o,
});
const tee = piece("tee", { colorIds: ["black"], brandId: "uniqlo", seasonIds: ["summer"], isFavorite: true, wearCount: 5, lastWornAt: at(-2), createdAt: at(-30), price: 25 });
const hoodie = piece("hoodie", { colorIds: ["black"], brandId: "nike", seasonIds: ["fall", "winter"], laundryStatus: "dirty", wearCount: 2, lastWornAt: at(-30), createdAt: at(-10), price: 60 });
const linen = piece("linen", { colorIds: ["white"], brandId: "jcrew", seasonIds: ["summer"], createdAt: at(-5), price: 90 });
const jeans = piece("jeans", { colorIds: ["navy"], brandId: "levis", seasonIds: ["summer", "fall", "winter", "spring"], wearCount: 12, lastWornAt: at(-1), createdAt: at(-100), price: 70, closetIds: ["family"] });
const shorts = piece("shorts", { colorIds: ["black"], brandId: "nike", seasonIds: ["summer"], laundryStatus: "cleaners", wearCount: 3, lastWornAt: at(-10), createdAt: at(-20) });
const all = [tee, hoodie, linen, jeans, shorts];
const ids = (xs: ViewItem[]) => xs.map((x) => x.id);
const f = (o: Partial<ReturnType<typeof emptyFilters>>) => ({ ...emptyFilters(), ...o });

describe("closet views: the URL", () => {
  it("reads the filters and the sort from the parameters; unknown sorts and empty lists fall away", () => {
    const { filters, sort } = parseClosetParams({ color: "black,white,black", season: "", fav: "1", unworn: "no", sort: "most-worn", cat: "c1" });
    expect(filters.color).toEqual(["black", "white"]);
    expect(filters.season).toEqual([]);
    expect(filters.favorites).toBe(true);
    expect(filters.unworn).toBe(false);
    expect(sort).toBe("most-worn");
    expect(parseClosetParams({ sort: "sideways" }).sort).toBe("newest");
    expect(parseClosetParams({ color: ["navy", "black"] }).filters.color).toEqual(["navy"]); // a repeated parameter: the first one
  });

  it("writes a view back as a query and reads it the same; the plain closet is no query at all", () => {
    expect(closetQuery({})).toBe("");
    expect(closetQuery({ sort: "newest", filters: emptyFilters() })).toBe("");
    const view = { filters: f({ color: ["black", "white"], status: ["dirty"], favorites: true }), sort: "price-low" as const };
    const query = closetQuery({ ...view, cat: "c1", q: "nike" });
    expect(query).toBe("?cat=c1&q=nike&color=black%2Cwhite&status=dirty&fav=1&sort=price-low");
    expect(parseClosetParams(Object.fromEntries(new URLSearchParams(query)))).toEqual(view);
    expect(activeFilterCount(view.filters)).toBe(4);
  });
});

describe("closet views: filters", () => {
  it("ANDs the facets, ORs the picks inside one, and knows the laundry, favorites, never worn and the closets", () => {
    expect(ids(applyFilters(all, emptyFilters()))).toEqual(ids(all));
    expect(ids(applyFilters(all, f({ color: ["black"] })))).toEqual(["tee", "hoodie", "shorts"]);
    expect(ids(applyFilters(all, f({ color: ["black"], brand: ["nike"] })))).toEqual(["hoodie", "shorts"]);
    expect(ids(applyFilters(all, f({ color: ["black", "white"] })))).toEqual(["tee", "hoodie", "linen", "shorts"]);
    expect(ids(applyFilters(all, f({ season: ["winter"] })))).toEqual(["hoodie", "jeans"]);
    expect(ids(applyFilters(all, f({ status: ["dirty", "cleaners"] })))).toEqual(["hoodie", "shorts"]);
    expect(ids(applyFilters(all, f({ favorites: true })))).toEqual(["tee"]);
    expect(ids(applyFilters(all, f({ unworn: true })))).toEqual(["linen"]);
    expect(ids(applyFilters(all, f({ closet: ["family"] })))).toEqual(["jeans"]);
    expect(ids(applyFilters(all, f({ color: ["black"], unworn: true })))).toEqual([]);
  });

  it("counts each option against every other filter, never against its own facet, so a pick leaves its siblings showing", () => {
    const black = f({ color: ["black"] });
    expect(Object.fromEntries(facetCounts(all, black, "color"))).toEqual({ black: 3, white: 1, navy: 1 });
    expect(Object.fromEntries(facetCounts(all, black, "brand"))).toEqual({ uniqlo: 1, nike: 2 });
    expect(Object.fromEntries(facetCounts(all, f({ brand: ["nike"] }), "status"))).toEqual({ dirty: 1, cleaners: 1 });
    expect(Object.fromEntries(facetCounts(all, f({ color: ["black"], favorites: true }), "season"))).toEqual({ summer: 1 });
    expect(toggleCounts(all, black)).toEqual({ favorites: 1, unworn: 0 });
    expect(toggleCounts(all, f({ favorites: true }))).toEqual({ favorites: 1, unworn: 0 }); // each toggle's count respects the other one: no favorite is unworn
    expect(toggleCounts(all, f({ unworn: true }))).toEqual({ favorites: 0, unworn: 1 });
  });
});

describe("closet views: sorts", () => {
  it("orders by age, wear, name and price, with the never-worn and the unpriced where they belong", () => {
    expect(ids(sortItems(all, "newest"))).toEqual(["linen", "hoodie", "shorts", "tee", "jeans"]);
    expect(ids(sortItems(all, "oldest"))).toEqual(["jeans", "tee", "shorts", "hoodie", "linen"]);
    expect(ids(sortItems(all, "recent"))).toEqual(["jeans", "tee", "shorts", "hoodie", "linen"]);
    expect(ids(sortItems(all, "forgotten"))).toEqual(["linen", "hoodie", "shorts", "tee", "jeans"]);
    expect(ids(sortItems(all, "most-worn"))).toEqual(["jeans", "tee", "shorts", "hoodie", "linen"]);
    expect(ids(sortItems(all, "least-worn"))).toEqual(["linen", "hoodie", "shorts", "tee", "jeans"]);
    expect(ids(sortItems(all, "name"))).toEqual(["hoodie", "jeans", "linen", "shorts", "tee"]);
    expect(ids(sortItems(all, "price-high"))).toEqual(["linen", "jeans", "hoodie", "tee", "shorts"]);
    expect(ids(sortItems(all, "price-low"))).toEqual(["tee", "hoodie", "jeans", "linen", "shorts"]);
  });

  it("leaves the input alone, breaks ties by newest then name, and sorts names like a person reads numbers", () => {
    const copy = [...all];
    sortItems(all, "name");
    expect(all).toEqual(copy);
    const a = piece("Tee 10", { createdAt: at(-1) }), b = piece("Tee 2", { createdAt: at(-1) }), c = piece("Tee 2", { createdAt: at(-3) });
    expect(ids(sortItems([a, b, c], "name"))).toEqual(["Tee 2", "Tee 2", "Tee 10"]);
    expect(sortItems([a, c, b], "name")[0]).toBe(b); // the newer of the two "Tee 2"
    expect(ids(sortItems([a, b, c], "most-worn"))).toEqual(["Tee 2", "Tee 10", "Tee 2"]); // all unworn: newest first, the name between the two of a day
  });
});

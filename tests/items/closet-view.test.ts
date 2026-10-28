import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { loadClosetView } from "@/lib/items/query";
import { emptyFilters } from "@/lib/items/views";
import { personalClosetId } from "@/lib/items/service";

const day = 86400000;
const ago = (d: number) => new Date(Date.now() - d * day);

describe("loadClosetView", () => {
  let jeff: { id: string; name: string }, olivia: { id: string }, ids: Record<string, string>, familyId: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true";
    await seed();
    jeff = await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" }, select: { id: true, name: true } });
    olivia = await db.person.findFirstOrThrow({ where: { name: "Olivia" }, select: { id: true } });
    const by = async (find: () => Promise<{ id: string }>) => (await find()).id;
    ids = {
      tops: await by(() => db.category.findFirstOrThrow({ where: { name: "Tops" } })),
      bottoms: await by(() => db.category.findFirstOrThrow({ where: { name: "Bottoms" } })),
      black: await by(() => db.color.findUniqueOrThrow({ where: { name: "Black" } })),
      white: await by(() => db.color.findUniqueOrThrow({ where: { name: "White" } })),
      summer: await by(() => db.season.findUniqueOrThrow({ where: { name: "Summer" } })),
      winter: await by(() => db.season.findUniqueOrThrow({ where: { name: "Winter" } })),
      nike: await by(() => db.brand.findUniqueOrThrow({ where: { name: "Nike" } })),
      levis: await by(() => db.brand.findUniqueOrThrow({ where: { name: "Levi's" } })),
      gym: await by(() => db.occasion.findUniqueOrThrow({ where: { name: "Gym" } })),
      comfy: await by(() => db.tag.findUniqueOrThrow({ where: { name: "Comfy" } })),
    };
    familyId = (await db.closet.findFirstOrThrow({ where: { kind: "family" } })).id;
    const mine = await personalClosetId(jeff.id);
    const make = (data: Parameters<typeof db.item.create>[0]["data"]) => db.item.create({ data });
    await make({ ownerId: jeff.id, name: "Black tee", categoryId: ids.tops, brandId: ids.nike, colors: { connect: [{ id: ids.black }] }, seasons: { connect: [{ id: ids.summer }] }, isFavorite: true, wearCount: 5, lastWornAt: ago(2), purchasePrice: 25, createdAt: ago(30), closets: { create: [{ closetId: mine }] } });
    await make({ ownerId: jeff.id, name: "Black hoodie", categoryId: ids.tops, brandId: ids.nike, colors: { connect: [{ id: ids.black }] }, seasons: { connect: [{ id: ids.winter }] }, tags: { connect: [{ id: ids.comfy }] }, laundryStatus: "dirty", wearCount: 2, lastWornAt: ago(30), purchasePrice: 60, createdAt: ago(10), closets: { create: [{ closetId: mine }] } });
    await make({ ownerId: jeff.id, name: "White shirt", categoryId: ids.tops, colors: { connect: [{ id: ids.white }] }, purchasePrice: 90, createdAt: ago(5), closets: { create: [{ closetId: mine }] } });
    await make({ ownerId: jeff.id, name: "Dark jeans", categoryId: ids.bottoms, brandId: ids.levis, occasions: { connect: [{ id: ids.gym }] }, wearCount: 12, lastWornAt: ago(1), purchasePrice: 70, createdAt: ago(100), closets: { create: [{ closetId: mine }, { closetId: familyId }] } });
    await make({ ownerId: jeff.id, name: "Given away", categoryId: ids.tops, colors: { connect: [{ id: ids.black }] }, retiredAt: ago(1), closets: { create: [{ closetId: mine }] } });
    await make({ ownerId: olivia.id, name: "Olivia's black tee", categoryId: ids.tops, colors: { connect: [{ id: ids.black }] } });
  });
  const view = () => ({ kind: "person" as const, personId: jeff.id, name: "Jeff" });

  it("shows the person's live pieces with every facet's counts, a swatch per color, the laundry words and the Family closet", async () => {
    const v = await loadClosetView(view(), { filters: emptyFilters(), sort: "newest" });
    expect(v.total).toBe(4); expect(v.shown).toBe(4);
    expect(v.items.map((i) => i.name)).toEqual(["White shirt", "Black hoodie", "Black tee", "Dark jeans"]);
    const facet = (k: string) => v.facets.find((f) => f.key === k)!;
    expect(facet("color").options).toEqual([{ id: ids.black, name: "Black", count: 2, hex: "#111111" }, { id: ids.white, name: "White", count: 1, hex: "#FFFFFF" }]);
    expect(facet("brand").options.map((o) => [o.name, o.count])).toEqual([["Nike", 2], ["Levi's", 1]]);
    expect(facet("season").options.map((o) => [o.name, o.count])).toEqual([["Summer", 1], ["Winter", 1]]);
    expect(facet("occasion").options.map((o) => [o.name, o.count])).toEqual([["Gym", 1]]);
    expect(facet("tag").options.map((o) => [o.name, o.count])).toEqual([["Comfy", 1]]);
    expect(facet("status").options.map((o) => [o.id, o.name, o.count])).toEqual([["clean", "Clean", 3], ["dirty", "In the laundry", 1]]);
    expect(facet("closet").options.map((o) => [o.name, o.count])).toEqual([["Family", 1]]);
    expect(v.facets.map((f) => f.key)).not.toContain("fabric"); // nothing tagged with one: no section
    expect(v.toggles).toEqual({ favorites: 1, unworn: 1 });
  });

  it("filters and sorts, keeps the sibling options of a picked facet, narrows by the tab and the search, and counts the whole view as the total", async () => {
    const black = { ...emptyFilters(), color: [ids.black] };
    const v = await loadClosetView(view(), { filters: black, sort: "price-high" });
    expect(v.shown).toBe(2); expect(v.total).toBe(4);
    expect(v.items.map((i) => i.name)).toEqual(["Black hoodie", "Black tee"]);
    expect(v.facets.find((f) => f.key === "color")!.options.map((o) => o.name)).toEqual(["Black", "White"]);
    expect(v.facets.find((f) => f.key === "brand")!.options).toEqual([{ id: ids.nike, name: "Nike", count: 2 }]);
    expect(v.toggles).toEqual({ favorites: 1, unworn: 0 });
    const laundry = await loadClosetView(view(), { filters: { ...black, status: ["dirty"] }, sort: "newest" });
    expect(laundry.items.map((i) => i.name)).toEqual(["Black hoodie"]);
    const tab = await loadClosetView(view(), { categoryId: ids.bottoms, filters: emptyFilters(), sort: "newest" });
    expect(tab.shown).toBe(1); expect(tab.total).toBe(4);
    expect(tab.facets.find((f) => f.key === "color")).toBeUndefined();
    const search = await loadClosetView(view(), { q: "nike", filters: { ...emptyFilters(), favorites: true }, sort: "newest" });
    expect(search.items.map((i) => i.name)).toEqual(["Black tee"]);
    const worn = await loadClosetView(view(), { filters: emptyFilters(), sort: "most-worn" });
    expect(worn.items.map((i) => i.name)).toEqual(["Dark jeans", "Black tee", "Black hoodie", "White shirt"]);
  });

  it("the Family closet view lists what is in it, from anyone, and leaves the Family closet out of its own filter", async () => {
    const v = await loadClosetView({ kind: "family" }, { filters: emptyFilters(), sort: "newest" });
    expect(v.items.map((i) => [i.name, i.ownerName])).toEqual([["Dark jeans", "Jeff"]]);
    expect(v.total).toBe(1);
    expect(v.facets.find((f) => f.key === "closet")).toBeUndefined();
  });
});

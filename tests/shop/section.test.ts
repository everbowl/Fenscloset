import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { inOtherSection, sectionKey, sectionOf, withSection } from "@/lib/shop/section";
import { searchProducts } from "@/lib/shop/products";
import { listEntries } from "@/lib/lists/service";

describe("shop section (Jeff, 2 Nov 2026: men's and women's came back together)", () => {
  beforeEach(async () => { await resetDb(); process.env.DEV_MODE = "true"; process.env.MOCK_SERPER = "true"; await seed(); });

  it("reads a section from its name, leads every search with it, and leaves a search alone that already says who it is for", () => {
    expect(sectionKey("Men's")).toBe("men");
    expect(sectionKey("Girls' (youth)")).toBe("girls");
    expect(sectionKey("Unisex")).toBeNull();
    expect(withSection(["slim dark wash jeans", "Women's dojo lake jeans"], "Men's")).toEqual(["men's slim dark wash jeans", "Women's dojo lake jeans"]);
    expect(withSection(["navy tee"], "Girls'")).toEqual(["girls' navy tee"]);
    expect(withSection(["navy tee"], "Unisex")).toEqual(["navy tee"]);
    expect(withSection(["navy tee"], null)).toEqual(["navy tee"]);
  });

  it("drops a result titled for another section only; keeps one that names both or neither", () => {
    expect(inOtherSection("7 For All Mankind Women's Dojo Lake", "Men's")).toBe(true);
    expect(inOtherSection("Levi's 318 Shaping Wide Leg Women's Jeans", "Men's")).toBe(true);
    expect(inOtherSection("Men's Jordan 6 Rings", "Men's")).toBe(false);
    expect(inOtherSection("Calvin Klein Men's 3-Pack Boxer Briefs", "Women's")).toBe(true);
    expect(inOtherSection("Unisex Hoodie for Men & Women", "Women's")).toBe(false); // names both
    expect(inOtherSection("Best Sellers V-Neck 5-Pack", "Men's")).toBe(false); // names neither
    expect(inOtherSection("Boys' Crew Tee", "Men's")).toBe(true);
    expect(inOtherSection("Women's Tee", "Unisex")).toBe(false); // a neutral section keeps everything
  });

  it("the product search leaves the other section out; the seed makes the list and puts Jeff in Men's", async () => {
    const women = await searchProducts(["women's jeans"], { favoriteStores: [], favoriteBrands: [], section: "Men's" });
    expect(women).toEqual([]);
    const mine = await searchProducts(withSection(["jeans"], "Men's"), { favoriteStores: [], favoriteBrands: [], section: "Men's" });
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((p) => /men's/i.test(p.title))).toBe(true);
    expect((await listEntries("shopSection")).map((s) => s.name)).toEqual(["Men's", "Women's", "Boys'", "Girls'", "Unisex"]);
    const jeff = await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } });
    expect(await sectionOf(jeff.id)).toMatchObject({ name: "Men's" });
    const mya = await db.person.findFirstOrThrow({ where: { name: { startsWith: "Mya" } } });
    expect(await sectionOf(mya.id)).toBeNull(); // picks hers on the Shop
  });
});

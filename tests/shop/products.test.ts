import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { isProductSearchConfigured, normalizeProduct, rankProducts, searchProducts, type Product } from "@/lib/shop/products";

const row = (title: string, source: string, i: number) => ({ title, source, link: `https://${source.toLowerCase().replace(/\W/g, "")}.com/p/${i}`, price: "$98.00", imageUrl: `https://img.example/${i}.jpg`, position: i });

describe("product search", () => {
  beforeEach(async () => { await resetDb(); delete process.env.MOCK_SERPER; process.env.SERPER_API_KEY = "test-key"; });

  it("normalizes Serper rows and drops junk", () => {
    expect(normalizeProduct({ title: " Slim Chino ", source: "J.Crew", link: "https://jcrew.com/p/1", price: 98, imageUrl: "http://insecure/x.jpg" }, "chinos")).toEqual({ title: "Slim Chino", priceText: "$98.00", storeName: "J.Crew", url: "https://jcrew.com/p/1", imageUrl: null, query: "chinos" });
    expect(normalizeProduct({ title: "No link" }, "q")).toBeNull();
    expect(normalizeProduct({ title: "Bad link", link: "javascript:alert(1)" }, "q")).toBeNull();
    expect(normalizeProduct({ title: "No store", link: "https://www.vuoriclothing.com/p/2" }, "q")?.storeName).toBe("vuoriclothing.com");
  });

  it("ranks favorite stores first, then favorite brands, keeping Google's order otherwise", () => {
    const ps = [row("Tee A", "Target", 1), row("Vuori Tee", "Zappos", 2), row("Tee C", "Nordstrom", 3)].map((r) => normalizeProduct(r, "tee")!) as Product[];
    expect(rankProducts(ps, { favoriteStores: ["Nordstrom"], favoriteBrands: ["Vuori"] }).map((p) => p.title)).toEqual(["Tee C", "Vuori Tee", "Tee A"]);
  });

  it("interleaves queries, dedupes links, caches a day, caps the row, and survives a failed query", async () => {
    const calls: string[] = [];
    const fake = (async (_url: string | URL | Request, init?: RequestInit) => {
      const q = JSON.parse(String(init?.body)).q as string;
      calls.push(q);
      if (q === "broken") return new Response("nope", { status: 500 });
      const rows = Array.from({ length: 8 }, (_, i) => row(`${q} ${i + 1}`, q === "jeans" ? "Levi's" : "Everlane", i + 1));
      if (q === "chinos") rows[0] = { ...rows[0], link: "https://levis.com/p/1" }; // same link as jeans #1 → dropped once
      return new Response(JSON.stringify({ shopping: rows }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const out = await searchProducts(["jeans", "chinos", "broken"], { favoriteStores: [], favoriteBrands: [] }, fake);
    expect(out.length).toBe(12);
    expect(out.slice(0, 3).map((p) => p.query)).toEqual(["jeans", "jeans", "chinos"]); // chinos #1 shared a link with jeans #1
    expect(new Set(out.map((p) => p.url)).size).toBe(12);
    expect(calls.sort()).toEqual(["broken", "chinos", "jeans"]);
    // cached: no new fetch for the same query
    await searchProducts(["jeans"], { favoriteStores: [], favoriteBrands: [] }, fake);
    expect(calls.length).toBe(3);
    expect(await db.weatherCache.count({ where: { key: { startsWith: "shop:q:" } } })).toBe(2);
  });

  it("returns nothing when no key is set, and mock rows with MOCK_SERPER", async () => {
    delete process.env.SERPER_API_KEY;
    expect(isProductSearchConfigured()).toBe(false);
    expect(await searchProducts(["jeans"], { favoriteStores: [], favoriteBrands: [] })).toEqual([]);
    process.env.MOCK_SERPER = "true";
    const out = await searchProducts(["men's jeans"], { favoriteStores: ["Vuori"], favoriteBrands: [] });
    expect(out.length).toBe(6);
    expect(out[0].storeName).toBe("Vuori");
    expect(out.every((p) => p.imageUrl && p.priceText)).toBe(true);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { isProductSearchConfigured, normalizeProduct, rankProducts, scrubQuery, searchProducts, searchProductsDetailed, type Product } from "@/lib/shop/products";

const row = (title: string, source: string, i: number) => ({ title, source, link: `https://${source.toLowerCase().replace(/\W/g, "")}.com/p/${i}`, price: "$98.00", imageUrl: `https://img.example/${i}.jpg`, position: i });

describe("product search", () => {
  beforeEach(async () => { await resetDb(); delete process.env.MOCK_SERPER; process.env.SERPER_API_KEY = "test-key"; });

  it("normalizes Serper rows and drops junk", () => {
    expect(normalizeProduct({ title: " Slim Chino ", source: "J.Crew", link: "https://jcrew.com/p/1", price: 98, imageUrl: "http://insecure/x.jpg" }, "chinos")).toEqual({ title: "Slim Chino", priceText: "$98.00", storeName: "J.Crew", url: "https://jcrew.com/p/1", imageUrl: null, query: "chinos" });
    expect(normalizeProduct({ title: "No link" }, "q")).toBeNull();
    expect(normalizeProduct({ title: "Bad link", link: "javascript:alert(1)" }, "q")).toBeNull();
    expect(normalizeProduct({ title: "No store", link: "https://www.vuoriclothing.com/p/2" }, "q")?.storeName).toBe("vuoriclothing.com");
  });

  it("ranks favorite stores first, then favorite brands, keeping Google's order otherwise; a store matches as a whole word or by its own domain", () => {
    const ps = [row("Tee A", "Target", 1), row("Vuori Tee", "Zappos", 2), row("Tee C", "Nordstrom", 3)].map((r) => normalizeProduct(r, "tee")!) as Product[];
    expect(rankProducts(ps, { favoriteStores: ["Nordstrom"], favoriteBrands: ["Vuori"] }).map((p) => p.title)).toEqual(["Tee C", "Vuori Tee", "Tee A"]);
    // review E F6: "On" and "Gap" used to match any store name or link that contained the letters
    const more = [row("Shorts", "Singapore Outlet", 1), row("Running shoe", "Zappos", 2), { ...row("Hoodie", "Shop", 3), link: "https://www.on.com/en-us/hoodie" }, row("Jeans", "Gap", 4)].map((r) => normalizeProduct(r, "q")!) as Product[];
    expect(rankProducts(more, { favoriteStores: ["On", "Gap"], favoriteBrands: [] }).map((p) => p.title)).toEqual(["Hoodie", "Jeans", "Shorts", "Running shoe"]);
  });

  it("never sends a size or a measurement to the stores (review E A4)", async () => {
    expect(scrubQuery("men's slim dark wash jeans 32x30")).toBe("men's slim dark wash jeans");
    expect(scrubQuery("women's navy cashmere crewneck size M")).toBe("women's navy cashmere crewneck");
    expect(scrubQuery("girls' rain jacket size 10, 34 in waist, 110 lb")).toBe("girls' rain jacket");
    expect(scrubQuery("white leather sneakers us 10")).toBe("white leather sneakers");
    expect(scrubQuery("men's XL hoodie")).toBe("men's hoodie");
    expect(scrubQuery("medium wash jeans, small-batch denim, plus size dress")).toBe("medium wash jeans, small-batch denim, plus size dress"); // words that only look like sizes stay
    expect(scrubQuery("L")).toBe("");
    const bodies: string[] = [];
    const fake = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ shopping: [row("Jeans 1", "Levi's", 1)] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    // a verdict's searches that slipped a size through the prompt
    const out = await searchProducts(["men's slim dark wash jeans 32x30", "tapered chino pants size 34", "32 in waist belt"], { favoriteStores: [], favoriteBrands: [] }, fake);
    expect(out.length).toBeGreaterThan(0);
    expect(bodies.length).toBe(3);
    for (const b of bodies) { expect(b).not.toMatch(/32|34|size|waist|\bin\b/i); }
    // every scrubbed query goes out exactly once; the three run in parallel, so their order is not part of the contract
    expect(bodies.map((b) => (JSON.parse(b) as { q: string }).q).sort()).toEqual(["belt", "men's slim dark wash jeans", "tapered chino pants"]);
  });

  it("says which searches the stores did not answer (review E B5)", async () => {
    const fake = (async (_url: string | URL | Request, init?: RequestInit) => {
      const q = JSON.parse(String(init?.body)).q as string;
      if (q === "down") return new Response("nope", { status: 503 });
      return new Response(JSON.stringify({ shopping: [row(`${q} 1`, "Everlane", 1)] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const out = await searchProductsDetailed(["tee", "down"], { favoriteStores: [], favoriteBrands: [] }, fake);
    expect(out.products.map((p) => p.title)).toEqual(["tee 1"]);
    expect(out.failed).toEqual(["down"]);
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

import { createHash } from "node:crypto";
import { db } from "@/lib/db";

/**
 * Real products with pictures and prices from many retailers, via Google Shopping through Serper
 * (https://serper.dev). The key lives only in Railway as SERPER_API_KEY. Without a key the Shop
 * falls back to plain store search links. Queries never carry body measurements: only the words
 * Claude wrote for the piece (category, color, fit, material) plus favorite brands.
 */

export type Product = {
  title: string;
  priceText: string | null;
  storeName: string;
  url: string;
  imageUrl: string | null;
  query: string;
};

export type ProductPrefs = { favoriteStores: string[]; favoriteBrands: string[] };

export const MAX_PRODUCTS = 12;
const PER_QUERY = 10;
const CACHE_HOURS = 24;

export function isProductSearchConfigured(): boolean {
  return process.env.MOCK_SERPER === "true" || Boolean(process.env.SERPER_API_KEY);
}

type RawShopping = { title?: string; source?: string; link?: string; price?: string | number; imageUrl?: string; position?: number };

/** Deterministic products for tests and local dev. */
export function mockProducts(query: string): RawShopping[] {
  const stores = ["Nordstrom", "Everlane", "J.Crew", "Vuori"];
  return Array.from({ length: 6 }, (_, i) => ({
    title: `${query.replace(/\b\w/g, (c) => c.toUpperCase())} ${i + 1}`,
    source: stores[i % stores.length],
    link: `https://mock.example/shop/${encodeURIComponent(query)}/${i + 1}`,
    price: `$${(48 + i * 20).toFixed(2)}`,
    imageUrl: `https://mock.example/img/${i + 1}.jpg`,
    position: i + 1,
  }));
}

/** One Serper Shopping call (or the mock), cached for a day per query. */
async function fetchQuery(query: string, fetchImpl: typeof fetch): Promise<RawShopping[]> {
  if (process.env.MOCK_SERPER === "true") return mockProducts(query);
  const key = `shop:q:${createHash("sha1").update(query.toLowerCase()).digest("hex")}`;
  const hit = await db.weatherCache.findUnique({ where: { key } });
  if (hit && Date.now() - hit.fetchedAt.getTime() < CACHE_HOURS * 3600 * 1000) return hit.payload as RawShopping[];
  const res = await fetchImpl("https://google.serper.dev/shopping", {
    method: "POST",
    headers: { "X-API-KEY": process.env.SERPER_API_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, gl: "us", hl: "en", num: PER_QUERY }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const json = (await res.json()) as { shopping?: RawShopping[] };
  const rows = Array.isArray(json.shopping) ? json.shopping : [];
  await db.weatherCache.upsert({ where: { key }, update: { payload: rows as object[], fetchedAt: new Date() }, create: { key, payload: rows as object[] } });
  return rows;
}

export function normalizeProduct(raw: RawShopping, query: string): Product | null {
  const url = typeof raw.link === "string" ? raw.link.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!/^https:\/\//.test(url) || !title) return null;
  const price = raw.price == null ? null : typeof raw.price === "number" ? `$${raw.price.toFixed(2)}` : String(raw.price).trim() || null;
  let storeName = typeof raw.source === "string" && raw.source.trim() ? raw.source.trim() : "";
  if (!storeName) { try { storeName = new URL(url).hostname.replace(/^www\./, ""); } catch { storeName = "Store"; } }
  const imageUrl = typeof raw.imageUrl === "string" && /^https:\/\//.test(raw.imageUrl) ? raw.imageUrl : null;
  return { title, priceText: price, storeName, url, imageUrl, query };
}

/** Favorite stores first, then favorite brands in the title, then Google's own order. Ties keep query order. */
export function rankProducts(products: Product[], prefs: ProductPrefs): Product[] {
  const stores = prefs.favoriteStores.map((s) => s.toLowerCase());
  const brands = prefs.favoriteBrands.map((b) => b.toLowerCase());
  const score = (p: Product) => (stores.some((s) => p.storeName.toLowerCase().includes(s) || p.url.toLowerCase().includes(s.replace(/\s+/g, ""))) ? 2 : 0) + (brands.some((b) => p.title.toLowerCase().includes(b)) ? 1 : 0);
  return products.map((p, i) => ({ p, i, s: score(p) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.p);
}

/**
 * Run each query, interleave the results so every query (and so several retailers) gets a turn,
 * drop duplicates, rank by the person's preferences, and cap the row.
 */
export async function searchProducts(queries: string[], prefs: ProductPrefs, fetchImpl: typeof fetch = fetch): Promise<Product[]> {
  const qs = [...new Set(queries.map((q) => q.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 3);
  if (!qs.length || !isProductSearchConfigured()) return [];
  const lists = await Promise.all(qs.map(async (q) => {
    try { return (await fetchQuery(q, fetchImpl)).map((r) => normalizeProduct(r, q)).filter((p): p is Product => Boolean(p)); }
    catch (e) { console.error("product search failed", q, e); return []; }
  }));
  const merged: Product[] = [];
  const seen = new Set<string>();
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const p = l[i];
      if (p && !seen.has(p.url)) { seen.add(p.url); merged.push(p); }
    }
  }
  return rankProducts(merged, prefs).slice(0, MAX_PRODUCTS);
}

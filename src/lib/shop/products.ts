import { createHash } from "node:crypto";
import { inOtherSection } from "./section";
import { db } from "@/lib/db";
import { catalogBrand } from "@/lib/brands/catalog";

/**
 * Real products with pictures and prices from many retailers, via Google Shopping through Serper
 * (https://serper.dev). The key lives only in Railway as SERPER_API_KEY. Without a key the Shop
 * falls back to plain store search links. Queries never carry body measurements: only the words
 * Claude wrote for the piece (category, color, fit, material) plus favorite brands. The prompts ask for that, and
 * `scrubQuery` makes sure of it before anything leaves the server (review E A4).
 */

export type Product = {
  title: string;
  priceText: string | null;
  storeName: string;
  url: string;
  imageUrl: string | null;
  query: string;
};

export type ProductPrefs = { favoriteStores: string[]; favoriteBrands: string[]; /** The section the person shops in (Men's, Women's…): results titled for another section are left out. */ section?: string | null };

const MAX_PRODUCTS = 12;
const PER_QUERY = 10;
const CACHE_HOURS = 24;

export function isProductSearchConfigured(): boolean {
  return process.env.MOCK_SERPER === "true" || Boolean(process.env.SERPER_API_KEY);
}

type RawShopping = { title?: string; source?: string; link?: string; price?: string | number; imageUrl?: string; position?: number };

// What a size looks like in a search: "size 10" / "size medium", waist×length, a number with a body unit (and the
// measurement word after it), a measurement named with its number, a US/EU shoe size, and a letter size standing on its
// own (never the s of men's, never the small of small-batch).
const SIZE_PATTERNS: RegExp[] = [
  /\bsizes?\s*:?\s*(?:us|eu|uk)?\s*(?:\d{1,2}(?:\.\d)?|xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|x-?small|small|medium|large|x-?large)\b/gi,
  /\b\d{2}\s?[x×]\s?\d{2}\b/gi,
  /\b\d+(?:\.\d+)?\s?(?:in|inch|inches|cm|mm|lb|lbs|kg|")(?![a-z])(?:\s+(?:waist|inseam|chest|bust|hips?|neck|sleeve|tall|long))?/gi,
  /\b(?:waist|inseam|chest|bust|hips?|neck|sleeve|height|weight)\s*:?\s*\d+(?:\.\d+)?\b/gi,
  /\b\d+(?:\.\d+)?\s*(?:waist|inseam|chest|bust)\b/gi,
  /\b(?:us|eu|uk)\s?\d{1,2}(?:\.5)?\b/gi,
  /(?<![\w'\u2019-])(?:xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl)(?![\w'\u2019-])/gi,
];

/** A search with every size and measurement taken out, tidied; "" when nothing is left. */
export function scrubQuery(query: string): string {
  let q = query;
  for (const re of SIZE_PATTERNS) q = q.replace(re, " ");
  return q.replace(/\s*[,;/]+\s*(?=[,;/]|$)/g, " ").replace(/\s+/g, " ").replace(/^[\s,;/-]+|[\s,;/-]+$/g, "").trim();
}

/** Deterministic products for tests and local dev. */
function mockProducts(query: string): RawShopping[] {
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

/** One Serper Shopping call (or the mock), cached per query for a day, or for `maxAgeHours` when the caller wants it fresher. */
async function fetchQuery(query: string, fetchImpl: typeof fetch, maxAgeHours = CACHE_HOURS): Promise<RawShopping[]> {
  if (process.env.MOCK_SERPER === "true") return mockProducts(query);
  const key = `shop:q:${createHash("sha1").update(query.toLowerCase()).digest("hex")}`;
  const hit = await db.weatherCache.findUnique({ where: { key } });
  if (hit && Date.now() - hit.fetchedAt.getTime() < maxAgeHours * 3600 * 1000) return hit.payload as RawShopping[];
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };

/** A product is from one of the favorite stores: the store's name as a whole word, or the link on the store's own domain (review E F6: "On" matched everything). */
export function isFavoriteStore(p: Product, favoriteStores: string[]): boolean {
  const host = hostOf(p.url);
  return favoriteStores.some((s) => {
    const name = s.trim();
    if (!name) return false;
    if (new RegExp(`(?<![\\w])${escapeRe(name.toLowerCase())}(?![\\w])`, "i").test(p.storeName)) return true;
    const domain = catalogBrand(name)?.domain.toLowerCase().replace(/^www\./, "");
    return Boolean(domain && host && (host === domain || host.endsWith(`.${domain}`)));
  });
}

/** Favorite stores first, then favorite brands in the title, then Google's own order. Ties keep query order. */
export function rankProducts(products: Product[], prefs: ProductPrefs): Product[] {
  const brands = prefs.favoriteBrands.map((b) => b.toLowerCase().trim()).filter(Boolean);
  const score = (p: Product) => (isFavoriteStore(p, prefs.favoriteStores) ? 2 : 0) + (brands.some((b) => new RegExp(`(?<![\\w])${escapeRe(b)}(?![\\w])`, "i").test(p.title)) ? 1 : 0);
  return products.map((p, i) => ({ p, i, s: score(p) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.p);
}

export type SearchOptions = {
  /** Reuse a cached answer up to this old (default a day). The Looking-for sweep asks for fresher so a new arrival is seen. */
  maxAgeHours?: number;
  /** Return up to this many (default MAX_PRODUCTS). */
  limit?: number;
};

/** What a search brought back, and which searches the stores did not answer (a 429, a 500, a timeout). */
export type SearchOutcome = { products: Product[]; failed: string[] };

/**
 * Run each query, interleave the results so every query (and so several retailers) gets a turn,
 * drop duplicates, rank by the person's preferences, and cap the row. Every query is scrubbed of sizes and
 * measurements first. `failed` names the searches the stores did not answer, so a screen can say so (review E B5).
 */
export async function searchProductsDetailed(queries: string[], prefs: ProductPrefs, fetchImpl: typeof fetch = fetch, opts: SearchOptions = {}): Promise<SearchOutcome> {
  const qs = [...new Set(queries.map((q) => scrubQuery(q)).filter(Boolean))].slice(0, 3);
  if (!qs.length || !isProductSearchConfigured()) return { products: [], failed: [] };
  const failed: string[] = [];
  const lists = await Promise.all(qs.map(async (q) => {
    try { return (await fetchQuery(q, fetchImpl, opts.maxAgeHours)).map((r) => normalizeProduct(r, q)).filter((p): p is Product => Boolean(p)); }
    catch (e) { console.error("product search failed", q, e); failed.push(q); return []; }
  }));
  const merged: Product[] = [];
  const seen = new Set<string>();
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const p = l[i];
      if (p && !seen.has(p.url)) { seen.add(p.url); merged.push(p); }
    }
  }
  return { products: rankProducts(merged.filter((p) => !inOtherSection(p.title, prefs.section)), prefs).slice(0, opts.limit ?? MAX_PRODUCTS), failed };
}

/** The products alone; most callers only need the row. */
export async function searchProducts(queries: string[], prefs: ProductPrefs, fetchImpl: typeof fetch = fetch, opts: SearchOptions = {}): Promise<Product[]> {
  return (await searchProductsDetailed(queries, prefs, fetchImpl, opts)).products;
}

/** The dollars in a price label ("$128.00", "128 USD"), or null when there is no number. */
export function priceDollars(priceText: string | null | undefined): number | null {
  if (!priceText) return null;
  const m = priceText.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

export type WebHit = { title: string; link: string };

/** Google web search through Serper: used to find a product's own page at its store. Mock returns the mock store page. */
export async function searchWeb(query: string, fetchImpl: typeof fetch = fetch): Promise<WebHit[]> {
  const q = query.replace(/\s+/g, " ").trim();
  if (!q || !isProductSearchConfigured()) return [];
  if (process.env.MOCK_SERPER === "true") return [{ title: "Linen Blazer | Mock Store", link: "https://mock.example/products/linen-blazer" }];
  const key = `web:q:${createHash("sha1").update(q.toLowerCase()).digest("hex")}`;
  const hit = await db.weatherCache.findUnique({ where: { key } });
  if (hit && Date.now() - hit.fetchedAt.getTime() < CACHE_HOURS * 3600 * 1000) return hit.payload as WebHit[];
  try {
    const res = await fetchImpl("https://google.serper.dev/search", {
      method: "POST", headers: { "X-API-KEY": process.env.SERPER_API_KEY ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ q, gl: "us", hl: "en", num: 10 }), signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { organic?: { title?: string; link?: string }[] };
    const rows = (json.organic ?? []).filter((r) => typeof r.link === "string" && /^https:\/\//.test(r.link)).map((r) => ({ title: r.title ?? "", link: r.link! }));
    await db.weatherCache.upsert({ where: { key }, update: { payload: rows, fetchedAt: new Date() }, create: { key, payload: rows } });
    return rows;
  } catch (e) { console.error("web search failed", q, e); return []; }
}

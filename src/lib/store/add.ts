import { db } from "@/lib/db";
import { readCapped, safeFetch } from "@/lib/net/safe-fetch";
import { newKey, putObject } from "@/lib/storage";
import { fetchImage, normalizeUrl, PageError, readProductPage } from "@/lib/shop/page";
import { searchProducts, type Product } from "@/lib/shop/products";
import { getOrCreateOpenBatch } from "@/lib/import/service";
import { enqueueProcessing } from "@/lib/import/queue";
import { MAX_COPIES } from "@/lib/items/copies";
import { makeThumb, placeholderPhoto } from "@/lib/images/thumb";

/**
 * Add from a store (plan 2026-10-18-add-from-store): a product link or a receipt line becomes
 * import entries with the store's photo and facts, which then run through the normal confirm card.
 * Nothing about the person goes to the store: only the page is read, and the product search
 * carries the product words alone.
 */

export type StoreProduct = {
  url: string;
  name: string;
  brandText: string | null;
  storeName: string;
  priceText: string | null;
  imageUrl: string | null;
  /** The store's own word for what it is (breadcrumb, JSON-LD category), when the page gave one; mapped onto the family's categories at tagging. */
  category?: string | null;
  /** Color and size choices the page offered (Shopify stores), else empty: the person types them. */
  colors: string[];
  sizes: string[];
  /** Photo per color when the page gave one. */
  colorImages: Record<string, string>;
  /** "page" when the store's page was read; "search" when the store blocked the link and the card came from a product search (check the photo). */
  source: "page" | "search";
};

/** The product words in a store link: "/p/metal-vent-tech-short-sleeve-shirt/prod10550086" → "metal vent tech short sleeve shirt". */
export function wordsFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean).map((seg) => decodeURIComponent(seg)).filter((seg) => !/^(p|products?|product|shop|item|items|dp|us|en|en-us|ca|women|men|womens|mens|collections?|c)$/i.test(seg));
    const words = parts.map((seg) => seg.replace(/\.(html?|aspx|php)$/i, "").replace(/[_-]+/g, " ")).join(" ")
      .replace(/\b(prod|sku|id|p)?\d{4,}\w*\b/gi, " ").replace(/\b[a-z]*\d+[a-z0-9]*\b/gi, " ").replace(/\s+/g, " ").trim();
    return words.slice(0, 80);
  } catch { return ""; }
}

/** What lands on ImportEntry.storeMeta and later on the item. */
export type StoreMeta = {
  name: string;
  brandText: string | null;
  storeName: string;
  priceText: string | null;
  url: string | null;
  imageUrl: string | null;
  color: string | null;
  size: string | null;
  purchaseDate: string | null;
  /** The category the store page or the receipt line knew (review B A2.2); wins over the guess when it names one of the family's categories. */
  category?: string | null;
  /** The store would not hand over its photo: a stand-in card is the photo until the person adds one; tagging is skipped. */
  noPhoto?: boolean;
  /** Set by the style match on a photo the person took: the store's facts, but the person's photo stays the photo of record. */
  matched?: boolean;
  fitNotes?: string | null;
  matchTitle?: string | null;
};

export class StoreAddError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "StoreAddError";
  }
}

/** "www.lululemon.com" → "Lululemon". */
export function storeNameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").replace(/^shop\./, "");
    const label = host.split(".").slice(0, -1).join(".") || host;
    return label.split(/[-.]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  } catch { return "Store"; }
}

type ShopifyProduct = { product_type?: string; options?: { name: string; values: string[] }[]; variants?: { option1?: string | null; option2?: string | null; option3?: string | null; featured_image?: { src?: string } | null }[]; images?: { src?: string }[] };

/** Shopify stores expose `/products/<handle>.json`: color and size options plus a photo per color, and the store's product type. */
const JSON_MAX_BYTES = 1 << 20; // a product JSON is kilobytes; a megabyte is already absurd

async function shopifyVariants(url: string): Promise<Pick<StoreProduct, "colors" | "sizes" | "colorImages" | "category">> {
  const empty = { colors: [], sizes: [], colorImages: {}, category: null };
  const u = new URL(url);
  const m = u.pathname.match(/\/products\/([^/?#]+)/);
  if (!m) return empty;
  let json: { product?: ShopifyProduct } | null = null;
  if (process.env.MOCK_FETCH === "true") {
    json = { product: { product_type: process.env.MOCK_SHOPIFY_TYPE ?? "", options: [{ name: "Color", values: ["Oatmeal", "Black"] }, { name: "Size", values: ["S", "M", "L"] }], variants: [{ option1: "Oatmeal", option2: "S", featured_image: { src: "https://mock.example/blazer.jpg" } }, { option1: "Black", option2: "S", featured_image: { src: "https://mock.example/blazer-black.jpg" } }] } };
  } else {
    try {
      // Through the guarded fetch like every other store call (security item 7): the origin came from a checked page, but a
      // redirect from the store itself was followed unchecked before, and the body was read whole.
      const { res } = await safeFetch(`${u.origin}/products/${m[1]}.json`, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" } }, { timeoutMs: 8000 });
      if (!res.ok || !/json/.test(res.headers.get("content-type") ?? "")) { await res.body?.cancel().catch(() => {}); return empty; }
      json = JSON.parse((await readCapped(res, JSON_MAX_BYTES)).toString("utf8")) as { product?: ShopifyProduct };
    } catch { return empty; }
  }
  const p = json?.product;
  if (!p?.options) return { ...empty, category: p?.product_type?.trim() || null };
  const idx = (re: RegExp) => p.options!.findIndex((o) => re.test(o.name));
  const ci = idx(/colou?r/i);
  const si = idx(/size/i);
  const colors = ci >= 0 ? p.options[ci].values : [];
  const sizes = si >= 0 ? p.options[si].values : [];
  const colorImages: Record<string, string> = {};
  if (ci >= 0) {
    for (const v of p.variants ?? []) {
      const color = [v.option1, v.option2, v.option3][ci];
      const src = v.featured_image?.src;
      if (color && src && !colorImages[color]) colorImages[color] = src.startsWith("//") ? `https:${src}` : src;
    }
  }
  return { colors, sizes, colorImages, category: p.product_type?.trim().slice(0, 60) || null };
}

/** Read a product link into a card: store photo, name, brand, store, price, and the page's color/size choices. */
export async function lookupProduct(input: string): Promise<StoreProduct> {
  let page;
  try { page = await readProductPage(input); } catch (e) {
    if (!(e instanceof PageError)) throw e;
    if (e.code === "bad_url") throw new StoreAddError(e.message);
    // Big stores (Lululemon, Nike…) block link previews. Fall back to a product search on the words in the link.
    const viaSearch = await lookupBySearch(input);
    if (viaSearch) return viaSearch;
    throw new StoreAddError(`${storeNameFromUrl(normalizeUrl(input).toString())} blocks link previews and no search match came back. Take a photo of the piece, or use the receipt.`);
  }
  const variants = await shopifyVariants(page.url).catch(() => ({ colors: [], sizes: [], colorImages: {}, category: null }));
  const name = (page.title ?? "").replace(/\s+[|–—-]\s+[^|–—-]*$/, "").trim() || page.title || "Untitled piece"; // "Classic V-Neck Tee | Store": only a spaced separator is a store suffix (review E F3)
  // The page's own category when src/lib/shop/page.ts learns to read one; the Shopify product type otherwise.
  const category = (page as { category?: string | null }).category ?? variants.category ?? null;
  return { url: page.url, name: name.slice(0, 80), brandText: page.brandText, storeName: page.siteName ?? storeNameFromUrl(page.url), priceText: page.priceText, imageUrl: page.imageUrl, colors: variants.colors, sizes: variants.sizes, colorImages: variants.colorImages, category, source: "page" };
}

/** A card from a product search on the link's words, preferring a hit on the same store. Null when nothing fits. */
async function lookupBySearch(input: string): Promise<StoreProduct | null> {
  const url = normalizeUrl(input).toString();
  const host = new URL(url).hostname.replace(/^www\./, "");
  const store = storeNameFromUrl(url);
  const words = wordsFromUrl(url);
  if (!words) return null;
  const hits = (await searchProducts([`${store} ${words}`], { favoriteStores: [store], favoriteBrands: [] })).filter((h) => h.imageUrl);
  const same = hits.find((h) => { try { return new URL(h.url).hostname.replace(/^www\./, "").endsWith(host.split(".").slice(-2).join(".")); } catch { return false; } });
  const hit = same ?? hits[0];
  if (!hit) return null;
  return { url, name: hit.title.slice(0, 80), brandText: store, storeName: store, priceText: hit.priceText, imageUrl: hit.imageUrl, colors: [], sizes: [], colorImages: {}, category: null, source: "search" };
}

/** Pictures of this product in a color, from Google Shopping; the person picks the one that matches. */
export async function findColorPhotos(product: Pick<StoreProduct, "name" | "brandText">, color: string): Promise<Product[]> {
  const q = [product.brandText, product.name, color].filter(Boolean).join(" ");
  return (await searchProducts([q], { favoriteStores: [], favoriteBrands: [] })).filter((p) => p.imageUrl);
}

export type StoreAddInput = {
  product: Pick<StoreProduct, "url" | "name" | "brandText" | "storeName" | "priceText"> & { category?: string | null };
  imageUrl: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  purchaseDate?: string | null;
};

export type StoreAddResult = { batchId: string; entryIds: string[]; pieces: number; /** Entries that got a stand-in picture because the store's photo could not be fetched. */ noPhoto: number };

/**
 * Make the entry: the store photo is downloaded once and stored under `originals/`; one entry stands for every
 * identical piece (`quantity`, Jeff 3 Nov 2026: ten of the same shirt is one card with ten copies), and a piece
 * with store facts lands in the closet on its own once tagged (C1). Returns the batch to continue on.
 *
 * When the store will not hand over its photo (hot-link block, an odd image type, a timeout) the piece is still
 * kept (review B, the add used to fail here): a stand-in card is its picture, the store's facts carry it, and the
 * result says so. The person adds a photo of their own from the piece page.
 */
export async function createStoreEntries(personId: string, input: StoreAddInput, batch?: { id: string; startOrder: number }): Promise<StoreAddResult> {
  const qty = Math.min(MAX_COPIES, Math.max(1, Math.floor(input.quantity || 1)));
  let imageUrl: string | null = null;
  if (input.imageUrl) { try { imageUrl = normalizeUrl(input.imageUrl).toString(); } catch { imageUrl = null; } }
  const image = imageUrl ? await fetchImage(imageUrl) : null;
  const noPhoto = !image;
  const meta: StoreMeta = {
    name: input.product.name.trim().slice(0, 80) || "Untitled piece", brandText: input.product.brandText?.trim() || null, storeName: input.product.storeName.trim().slice(0, 60) || "Store",
    priceText: input.product.priceText, url: input.product.url, imageUrl, color: input.color?.trim().slice(0, 40) || null, size: input.size?.trim().slice(0, 20) || null,
    purchaseDate: input.purchaseDate && /^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate) ? input.purchaseDate : null,
    category: input.product.category?.trim().slice(0, 60) || null,
    ...(noPhoto ? { noPhoto: true } : {}),
  };
  const b = batch ?? await getOrCreateOpenBatch(personId, 1);
  const photo = image ?? { data: await placeholderPhoto(), contentType: "image/jpeg" };
  const key = newKey("originals", personId, photo.contentType);
  // A small thumbnail right away (review B B13): the Tagging card in the closet shows it instead of the full-size photo.
  const thumbKey = newKey("thumbs", personId, "image/jpeg");
  await Promise.all([putObject(key, photo.data, photo.contentType), makeThumb(photo.data).then((t) => putObject(thumbKey, t, "image/jpeg")).catch(() => undefined)]);
  const entry = await db.importEntry.create({ data: { batchId: b.id, order: b.startOrder, originalKey: key, thumbKey, status: "uploaded", quantity: qty, storeMeta: JSON.parse(JSON.stringify(meta)) } });
  enqueueProcessing(entry.id);
  return { batchId: b.id, entryIds: [entry.id], pieces: qty, noPhoto: noPhoto ? 1 : 0 };
}

/** One row of the bulk add: a color and size with how many, and the photo for it (the page's photo for that color, a search pick, or the page's main photo). */
export type StoreRowInput = { color: string | null; size: string | null; quantity: number; imageUrl: string | null };
const MAX_ROWS = 30;
const ROWS_AT_ONCE = 4;

/** Up to `limit` at a time, in order; results in input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Several rows of one product at once (Jeff, 2 Nov 2026: "I own 7 of these, all Medium, these colors…", or
 * a count beside every color): every row becomes its entries in the same open batch, a few downloads at a time
 * (review B E9). Rows with no count are skipped.
 */
export async function createStoreRows(personId: string, product: StoreAddInput["product"], rows: StoreRowInput[], purchaseDate?: string | null): Promise<StoreAddResult> {
  const usable = rows.filter((r) => r && r.quantity > 0).slice(0, MAX_ROWS);
  if (!usable.length) throw new StoreAddError("Say how many of at least one color.");
  const batch = await getOrCreateOpenBatch(personId, usable.length);
  const made = await mapLimit(usable, ROWS_AT_ONCE, (r, i) => createStoreEntries(personId, { product, imageUrl: r.imageUrl, color: r.color, size: r.size, quantity: r.quantity, purchaseDate }, { id: batch.id, startOrder: batch.startOrder + i }));
  return { batchId: batch.id, entryIds: made.flatMap((m) => m.entryIds), pieces: made.reduce((n, m) => n + m.pieces, 0), noPhoto: made.reduce((n, m) => n + m.noPhoto, 0) };
}

/** Price text like "$128.00" or "128 USD" → "128.00" for the item, else null. */
export function priceNumber(priceText: string | null | undefined): string | null {
  const m = (priceText ?? "").replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? n.toFixed(2) : null;
}

/**
 * The Stores list is editable in-app; a new store from a link or receipt is added to it once. Two pieces from a
 * new store landing together both miss the lookup (review B A2.1): the second create hits the unique name and
 * reads the row the first one made instead of failing the add.
 */
export async function storeIdByName(name: string): Promise<string> {
  const clean = name.trim().slice(0, 60) || "Store";
  const found = await db.store.findFirst({ where: { name: { equals: clean, mode: "insensitive" } } });
  if (found) return found.id;
  const last = await db.store.aggregate({ _max: { sortOrder: true } });
  try {
    return (await db.store.create({ data: { name: clean, sortOrder: (last._max.sortOrder ?? 0) + 1 } })).id;
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
    const again = await db.store.findFirst({ where: { name: { equals: clean, mode: "insensitive" } } });
    if (!again) throw e;
    return again.id;
  }
}

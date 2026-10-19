import { db } from "@/lib/db";
import { newKey, putObject } from "@/lib/storage";
import { fetchImage, normalizeUrl, PageError, readProductPage } from "@/lib/shop/page";
import { searchProducts, type Product } from "@/lib/shop/products";
import { getOrCreateOpenBatch, ImportError } from "@/lib/import/service";
import { enqueueProcessing } from "@/lib/import/queue";

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

type ShopifyProduct = { options?: { name: string; values: string[] }[]; variants?: { option1?: string | null; option2?: string | null; option3?: string | null; featured_image?: { src?: string } | null }[]; images?: { src?: string }[] };

/** Shopify stores expose `/products/<handle>.json`: color and size options plus a photo per color. */
async function shopifyVariants(url: string): Promise<Pick<StoreProduct, "colors" | "sizes" | "colorImages">> {
  const empty = { colors: [], sizes: [], colorImages: {} };
  const u = new URL(url);
  const m = u.pathname.match(/\/products\/([^/?#]+)/);
  if (!m) return empty;
  let json: { product?: ShopifyProduct } | null = null;
  if (process.env.MOCK_FETCH === "true") {
    json = { product: { options: [{ name: "Color", values: ["Oatmeal", "Black"] }, { name: "Size", values: ["S", "M", "L"] }], variants: [{ option1: "Oatmeal", option2: "S", featured_image: { src: "https://mock.example/blazer.jpg" } }, { option1: "Black", option2: "S", featured_image: { src: "https://mock.example/blazer-black.jpg" } }] } };
  } else {
    try {
      const res = await fetch(`${u.origin}/products/${m[1]}.json`, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok || !/json/.test(res.headers.get("content-type") ?? "")) return empty;
      json = (await res.json()) as { product?: ShopifyProduct };
    } catch { return empty; }
  }
  const p = json?.product;
  if (!p?.options) return empty;
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
  return { colors, sizes, colorImages };
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
  const variants = await shopifyVariants(page.url).catch(() => ({ colors: [], sizes: [], colorImages: {} }));
  const name = (page.title ?? "").replace(/\s*[|–-]\s*[^|–-]*$/, "").trim() || page.title || "Untitled piece";
  return { url: page.url, name: name.slice(0, 80), brandText: page.brandText, storeName: page.siteName ?? storeNameFromUrl(page.url), priceText: page.priceText, imageUrl: page.imageUrl, ...variants, source: "page" };
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
  return { url, name: hit.title.slice(0, 80), brandText: store, storeName: store, priceText: hit.priceText, imageUrl: hit.imageUrl, colors: [], sizes: [], colorImages: {}, source: "search" };
}

/** Pictures of this product in a color, from Google Shopping; the person picks the one that matches. */
export async function findColorPhotos(product: Pick<StoreProduct, "name" | "brandText">, color: string): Promise<Product[]> {
  const q = [product.brandText, product.name, color].filter(Boolean).join(" ");
  return (await searchProducts([q], { favoriteStores: [], favoriteBrands: [] })).filter((p) => p.imageUrl);
}

export type StoreAddInput = {
  product: Pick<StoreProduct, "url" | "name" | "brandText" | "storeName" | "priceText">;
  imageUrl: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  purchaseDate?: string | null;
};

/**
 * Make the entries: the store photo is downloaded once and stored under `originals/` for each piece
 * (one entry per piece so each gets its own confirm). Returns the batch to continue on.
 */
export async function createStoreEntries(personId: string, input: StoreAddInput): Promise<{ batchId: string; entryIds: string[] }> {
  const qty = Math.min(10, Math.max(1, Math.floor(input.quantity || 1)));
  if (!input.imageUrl) throw new StoreAddError("Pick a photo for this piece first.");
  let imageUrl: string;
  try { imageUrl = normalizeUrl(input.imageUrl).toString(); } catch { throw new StoreAddError("That photo link isn't usable."); }
  const image = await fetchImage(imageUrl);
  if (!image) throw new StoreAddError("The store's photo could not be downloaded. Take a photo of the piece instead.");
  const meta: StoreMeta = {
    name: input.product.name.trim().slice(0, 80) || "Untitled piece", brandText: input.product.brandText?.trim() || null, storeName: input.product.storeName.trim().slice(0, 60) || "Store",
    priceText: input.product.priceText, url: input.product.url, imageUrl, color: input.color?.trim().slice(0, 40) || null, size: input.size?.trim().slice(0, 20) || null,
    purchaseDate: input.purchaseDate && /^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate) ? input.purchaseDate : null,
  };
  const batch = await getOrCreateOpenBatch(personId, qty);
  const entryIds: string[] = [];
  for (let i = 0; i < qty; i++) {
    const key = newKey("originals", personId, image.contentType);
    await putObject(key, image.data, image.contentType);
    const entry = await db.importEntry.create({ data: { batchId: batch.id, order: batch.startOrder + i, originalKey: key, status: "uploaded", storeMeta: JSON.parse(JSON.stringify(meta)) } });
    entryIds.push(entry.id);
    enqueueProcessing(entry.id);
  }
  if (!entryIds.length) throw new ImportError("Nothing to add.");
  return { batchId: batch.id, entryIds };
}

/** Price text like "$128.00" or "128 USD" → "128.00" for the item, else null. */
export function priceNumber(priceText: string | null | undefined): string | null {
  const m = (priceText ?? "").replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? n.toFixed(2) : null;
}

/** The Stores list is editable in-app; a new store from a link or receipt is added to it once. */
export async function storeIdByName(name: string): Promise<string> {
  const found = await db.store.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (found) return found.id;
  const last = await db.store.aggregate({ _max: { sortOrder: true } });
  return (await db.store.create({ data: { name, sortOrder: (last._max.sortOrder ?? 0) + 1 } })).id;
}

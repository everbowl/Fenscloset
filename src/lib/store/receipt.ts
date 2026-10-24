import { isMockAi, structured } from "@/lib/ai/claude";
import { searchProducts, searchWeb, type Product } from "@/lib/shop/products";
import { lookupProduct, type StoreProduct } from "@/lib/store/add";

/**
 * A receipt (order email screenshot or a paper receipt) → the pieces on it, each matched to a
 * product picture by Google Shopping search. The receipt image is read once and deleted (Q A):
 * only the item facts and prices are kept, never order numbers, addresses or card digits.
 */

export type ReceiptLine = { name: string; color: string | null; size: string | null; quantity: number; priceText: string | null; url: string | null };
export type Receipt = { storeName: string | null; orderDate: string | null; lines: ReceiptLine[] };
export type MatchedLine = ReceiptLine & { picks: Product[] };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["storeName", "orderDate", "lines"],
  properties: {
    storeName: { type: ["string", "null"], description: "The store or brand that sold the items, or null." },
    orderDate: { type: ["string", "null"], description: "Order or purchase date as YYYY-MM-DD, or null." },
    lines: {
      type: "array",
      description: "One entry per clothing, shoe or accessory line. Skip shipping, tax, discounts and non-clothing lines.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "color", "size", "quantity", "priceText", "url"],
        properties: {
          name: { type: "string", description: "The product name as printed, without color and size." },
          url: { type: ["string", "null"], description: "The product's own web link if one is printed or visible for this line, else null." },
          color: { type: ["string", "null"] },
          size: { type: ["string", "null"] },
          quantity: { type: "integer", description: "How many of this line; 1 when not shown." },
          priceText: { type: ["string", "null"], description: "Unit price as printed, e.g. $98.00, or null." },
        },
      },
    },
  },
};

export async function readReceipt(image: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }): Promise<Receipt> {
  if (isMockAi()) {
    return { storeName: "Mock Store", orderDate: "2026-10-12", lines: [
      { name: "Linen Blazer", color: "Oatmeal", size: "M", quantity: 1, priceText: "$128.00", url: "https://mock.example/products/linen-blazer" },
      { name: "Crew Tee", color: "Black", size: "M", quantity: 2, priceText: "$38.00", url: null },
    ] };
  }
  const r = await structured<Receipt>({
    system: "You read shopping receipts and order confirmation emails. Answer with JSON only. Copy product names as printed. Never include order numbers, addresses, phone numbers or payment details.",
    prompt: "Read this receipt.",
    image,
    schema: SCHEMA,
    effort: "low",
  });
  return { storeName: r.storeName?.trim() || null, orderDate: r.orderDate && /^\d{4}-\d{2}-\d{2}$/.test(r.orderDate) ? r.orderDate : null, lines: (r.lines ?? []).slice(0, 25).map((l) => ({ ...l, url: l.url && /^https?:\/\//i.test(l.url) ? l.url : null, quantity: Math.min(10, Math.max(1, Math.floor(l.quantity || 1))) })) };
}

/** The photo the store shows for this color, when its page lists one. */
function colorImage(p: StoreProduct, color: string | null): string | null {
  if (!color) return p.imageUrl;
  const want = color.toLowerCase();
  const key = Object.keys(p.colorImages).find((k) => k.toLowerCase() === want) ?? Object.keys(p.colorImages).find((k) => want.includes(k.toLowerCase()) || k.toLowerCase().includes(want));
  return (key && p.colorImages[key]) || p.imageUrl;
}

/** Find the line's own page at the store: the link on the receipt, else a web search limited to pages at that store. */
async function storePage(storeName: string | null, line: ReceiptLine): Promise<string | null> {
  if (line.url) return line.url;
  if (!storeName) return null;
  const words = storeName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const hits = await searchWeb(`${storeName} ${line.name}`);
  return hits.find((h) => { try { const host = new URL(h.link).hostname.toLowerCase(); return words.some((w) => host.includes(w)); } catch { return false; } })?.link ?? null;
}

/** The exact item at the store as a pick: its page read, the photo for the receipt's color. Null when the store blocks the read. */
async function exactPick(storeName: string | null, line: ReceiptLine): Promise<Product | null> {
  const url = await storePage(storeName, line);
  if (!url) return null;
  try {
    const p = await lookupProduct(url);
    const imageUrl = colorImage(p, line.color);
    if (!imageUrl) return null;
    return { title: p.name, priceText: p.priceText ?? line.priceText, storeName: p.storeName, url: p.url, imageUrl, query: "exact" };
  } catch { return null; }
}

/**
 * Each line: the exact item from the store's own page first (its link on the receipt, else the
 * store's page found by search), then up to five Google Shopping pictures as alternatives.
 */
export async function matchReceipt(receipt: Receipt): Promise<MatchedLine[]> {
  return Promise.all(receipt.lines.map(async (line) => {
    const q = [receipt.storeName, line.name, line.color].filter(Boolean).join(" ");
    const [exact, found] = await Promise.all([
      exactPick(receipt.storeName, line),
      searchProducts([q], { favoriteStores: receipt.storeName ? [receipt.storeName] : [], favoriteBrands: [] }),
    ]);
    const seen = new Set<string>();
    const picks: Product[] = [];
    for (const p of [exact, ...found]) if (p?.imageUrl && !seen.has(p.url)) { seen.add(p.url); picks.push(p); }
    return { ...line, picks: picks.slice(0, 6) };
  }));
}

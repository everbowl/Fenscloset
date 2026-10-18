import { isMockAi, structured } from "@/lib/ai/claude";
import { searchProducts, type Product } from "@/lib/shop/products";

/**
 * A receipt (order email screenshot or a paper receipt) → the pieces on it, each matched to a
 * product picture by Google Shopping search. The receipt image is read once and deleted (Q A):
 * only the item facts and prices are kept, never order numbers, addresses or card digits.
 */

export type ReceiptLine = { name: string; color: string | null; size: string | null; quantity: number; priceText: string | null };
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
        required: ["name", "color", "size", "quantity", "priceText"],
        properties: {
          name: { type: "string", description: "The product name as printed, without color and size." },
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
      { name: "Linen Blazer", color: "Oatmeal", size: "M", quantity: 1, priceText: "$128.00" },
      { name: "Crew Tee", color: "Black", size: "M", quantity: 2, priceText: "$38.00" },
    ] };
  }
  const r = await structured<Receipt>({
    system: "You read shopping receipts and order confirmation emails. Answer with JSON only. Copy product names as printed. Never include order numbers, addresses, phone numbers or payment details.",
    prompt: "Read this receipt.",
    image,
    schema: SCHEMA,
    effort: "low",
  });
  return { storeName: r.storeName?.trim() || null, orderDate: r.orderDate && /^\d{4}-\d{2}-\d{2}$/.test(r.orderDate) ? r.orderDate : null, lines: (r.lines ?? []).slice(0, 25).map((l) => ({ ...l, quantity: Math.min(10, Math.max(1, Math.floor(l.quantity || 1))) })) };
}

/** Each line gets up to six product pictures to choose from; the first is the best guess. */
export async function matchReceipt(receipt: Receipt): Promise<MatchedLine[]> {
  return Promise.all(receipt.lines.map(async (line) => {
    const q = [receipt.storeName, line.name, line.color].filter(Boolean).join(" ");
    const picks = (await searchProducts([q], { favoriteStores: receipt.storeName ? [receipt.storeName] : [], favoriteBrands: [] })).filter((p) => p.imageUrl).slice(0, 6);
    return { ...line, picks };
  }));
}

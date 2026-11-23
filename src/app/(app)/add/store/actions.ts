"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { createStoreEntries, createStoreRows, findColorPhotos, lookupProduct, mapLimit, StoreAddError, type StoreAddInput, type StoreProduct, type StoreRowInput } from "@/lib/store/add";
import { ownedRowsFromWords, type OwnedPage, type OwnedRow } from "@/lib/store/words";
import { matchReceipt, readReceipt, type MatchedLine, type Receipt } from "@/lib/store/receipt";
import { getOrCreateOpenBatch, ImportError } from "@/lib/import/service";
import { toAiImage } from "@/lib/images/thumb";
import { AiError } from "@/lib/ai/claude";
import { listEntries } from "@/lib/lists/service";
import type { Product } from "@/lib/shop/products";

export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof StoreAddError || e instanceof ImportError) return { ok: false, error: e.message };
  if (e instanceof AiError) return { ok: false, error: e.code === "no_key" ? "Reading is not set up yet (missing ANTHROPIC_API_KEY)." : `Reading failed: ${e.message}` };
  console.error(e);
  return { ok: false, error: "Something went wrong. Try again." };
}

export async function lookupProductAction(url: string): Promise<ActionResult<StoreProduct>> {
  await requirePerson();
  try { return { ok: true, value: await lookupProduct(url) }; } catch (e) { return fail(e); }
}

export async function colorPhotosAction(product: Pick<StoreProduct, "name" | "brandText">, color: string): Promise<ActionResult<Product[]>> {
  await requirePerson();
  try { return { ok: true, value: await findColorPhotos(product, color) }; } catch (e) { return fail(e); }
}

/** "Tell it in words" on the product card: the note becomes rows of color, size and how many. */
export async function ownedRowsAction(page: OwnedPage, text: string): Promise<ActionResult<OwnedRow[]>> {
  await requirePerson();
  try { return { ok: true, value: await ownedRowsFromWords(String(text ?? ""), { name: String(page.name ?? "").slice(0, 80), colors: (page.colors ?? []).slice(0, 60), sizes: (page.sizes ?? []).slice(0, 40) }) }; } catch (e) { return fail(e); }
}

export type StoreAddSummary = { batchId: string; count: number; /** Pieces whose photo the store would not give: they are in, with a stand-in picture. */ noPhoto: number };

/** Every row of the product at once: one entry per piece, all in the same batch. */
export async function addStoreRowsAction(input: { product: StoreAddInput["product"]; rows: StoreRowInput[] }): Promise<ActionResult<StoreAddSummary>> {
  const person = await requirePerson();
  try {
    const r = await createStoreRows(person.id, input.product, input.rows ?? []);
    revalidatePath("/add"); revalidatePath("/closet");
    return { ok: true, value: { batchId: r.batchId, count: r.pieces, noPhoto: r.noPhoto } };
  } catch (e) { return fail(e); }
}

const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;

/**
 * The receipt comes in the action itself (a FormData with the picture), is read by Claude, matched, and forgotten:
 * nothing is ever written to the bucket, so a closed tab or a dropped connection cannot leave an order confirmation
 * behind (review B E6, E7). Only the lines and prices go back to the phone.
 */
export async function readReceiptAction(form: FormData): Promise<ActionResult<{ receipt: Receipt; lines: MatchedLine[] }>> {
  await requirePerson();
  const file = form.get("receipt");
  if (!(file instanceof Blob) || file.size === 0) return { ok: false, error: "No receipt picture came through. Try again." };
  if (file.size > MAX_RECEIPT_BYTES) return { ok: false, error: "That picture is too big. A screenshot of the receipt works." };
  try {
    const [bytes, categories] = await Promise.all([file.arrayBuffer(), listEntries("category")]);
    const receipt = await readReceipt(await toAiImage(Buffer.from(bytes)), categories.map((c) => c.name));
    const lines = await matchReceipt(receipt);
    return { ok: true, value: { receipt, lines } };
  } catch (e) { return fail(e); }
}

export type ReceiptGroupInput = { storeName: string; purchaseDate: string | null; lines: { name: string; color: string | null; size: string | null; quantity: number; priceText: string | null; category?: string | null; pick: Product | null }[] };

/**
 * Every line of every receipt at once: one entry per piece, with the chosen picture and that receipt's store and
 * date, a few downloads at a time in one batch (review B E8). Lines without a picture are skipped and counted.
 */
export async function addReceiptsAction(groups: ReceiptGroupInput[]): Promise<ActionResult<{ batchId: string | null; count: number; noPhoto: number; skipped: number }>> {
  const person = await requirePerson();
  try {
    const jobs: { g: ReceiptGroupInput; l: ReceiptGroupInput["lines"][number] }[] = [];
    let skipped = 0;
    for (const g of (groups ?? []).slice(0, 40)) for (const l of (g.lines ?? []).slice(0, 25)) {
      if (!l.pick?.imageUrl) skipped += l.quantity; else jobs.push({ g, l });
    }
    if (!jobs.length) return { ok: true, value: { batchId: null, count: 0, noPhoto: 0, skipped } };
    const batch = await getOrCreateOpenBatch(person.id, jobs.length);
    const made = await mapLimit(jobs, 4, ({ g, l }, i) => createStoreEntries(person.id, {
      product: { url: l.pick!.url, name: l.name, brandText: null, storeName: g.storeName || l.pick!.storeName, priceText: l.priceText ?? l.pick!.priceText, category: l.category ?? null },
      imageUrl: l.pick!.imageUrl, color: l.color, size: l.size, quantity: l.quantity, purchaseDate: g.purchaseDate,
    }, { id: batch.id, startOrder: batch.startOrder + i }));
    revalidatePath("/add"); revalidatePath("/closet");
    return { ok: true, value: { batchId: batch.id, count: made.reduce((n, m) => n + m.pieces, 0), noPhoto: made.reduce((n, m) => n + m.noPhoto, 0), skipped } };
  } catch (e) { return fail(e); }
}

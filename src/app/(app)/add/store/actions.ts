"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { createStoreEntries, createStoreRows, findColorPhotos, lookupProduct, StoreAddError, type StoreAddInput, type StoreProduct, type StoreRowInput } from "@/lib/store/add";
import { ownedRowsFromWords, type OwnedPage, type OwnedRow } from "@/lib/store/words";
import { matchReceipt, readReceipt, type MatchedLine, type Receipt } from "@/lib/store/receipt";
import { ImportError } from "@/lib/import/service";
import { deleteObject, getObject, parseKey } from "@/lib/storage";
import { toAiImage } from "@/lib/images/thumb";
import { AiError } from "@/lib/ai/claude";
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

/** Every row of the product at once: one entry per piece, all in the same batch. */
export async function addStoreRowsAction(input: { product: StoreAddInput["product"]; rows: StoreRowInput[] }): Promise<ActionResult<{ batchId: string; count: number }>> {
  const person = await requirePerson();
  try {
    const r = await createStoreRows(person.id, input.product, input.rows ?? []);
    revalidatePath("/add");
    return { ok: true, value: { batchId: r.batchId, count: r.pieces } };
  } catch (e) { return fail(e); }
}

/** The receipt was uploaded under labels/ by the phone; read it, match each line, then delete the image (Q A). */
export async function readReceiptAction(key: string): Promise<ActionResult<{ receipt: Receipt; lines: MatchedLine[] }>> {
  const person = await requirePerson();
  const parsed = parseKey(key);
  if (!parsed || parsed.ownerId !== person.id || parsed.kind !== "labels") return { ok: false, error: "That photo is not yours." };
  try {
    const { body } = await getObject(key);
    const receipt = await readReceipt(await toAiImage(body));
    const lines = await matchReceipt(receipt);
    return { ok: true, value: { receipt, lines } };
  } catch (e) { return fail(e); }
  finally { await deleteObject(key).catch(() => undefined); }
}

export type ReceiptGroupInput = { storeName: string; purchaseDate: string | null; lines: { name: string; color: string | null; size: string | null; quantity: number; priceText: string | null; pick: Product | null }[] };

/** Every line of every receipt at once: one entry per piece, with the chosen picture and that receipt's store and date. Lines without a picture are skipped and counted. */
export async function addReceiptsAction(groups: ReceiptGroupInput[]): Promise<ActionResult<{ batchId: string | null; count: number; skipped: number }>> {
  const person = await requirePerson();
  let batchId: string | null = null; let count = 0; let skipped = 0;
  try {
    for (const g of (groups ?? []).slice(0, 40)) {
      for (const l of (g.lines ?? []).slice(0, 25)) {
        if (!l.pick?.imageUrl) { skipped += l.quantity; continue; }
        const r = await createStoreEntries(person.id, {
          product: { url: l.pick.url, name: l.name, brandText: null, storeName: g.storeName || l.pick.storeName, priceText: l.priceText ?? l.pick.priceText },
          imageUrl: l.pick.imageUrl, color: l.color, size: l.size, quantity: l.quantity, purchaseDate: g.purchaseDate,
        });
        batchId = r.batchId; count += r.pieces;
      }
    }
    revalidatePath("/add");
    return { ok: true, value: { batchId, count, skipped } };
  } catch (e) { return fail(e); }
}

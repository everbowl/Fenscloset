"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { createStoreEntries, findColorPhotos, lookupProduct, StoreAddError, type StoreAddInput, type StoreProduct } from "@/lib/store/add";
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

export async function addFromStoreAction(input: StoreAddInput): Promise<ActionResult<{ batchId: string; count: number }>> {
  const person = await requirePerson();
  try {
    const r = await createStoreEntries(person.id, input);
    revalidatePath("/add");
    return { ok: true, value: { batchId: r.batchId, count: r.entryIds.length } };
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

/** Every line at once: one entry per piece, with the chosen picture and the receipt's date. */
export async function addReceiptLinesAction(storeName: string, purchaseDate: string | null, lines: { name: string; color: string | null; size: string | null; quantity: number; priceText: string | null; pick: Product | null }[]): Promise<ActionResult<{ batchId: string | null; count: number; skipped: number }>> {
  const person = await requirePerson();
  let batchId: string | null = null; let count = 0; let skipped = 0;
  try {
    for (const l of lines) {
      if (!l.pick?.imageUrl) { skipped += l.quantity; continue; }
      const r = await createStoreEntries(person.id, {
        product: { url: l.pick.url, name: l.name, brandText: null, storeName: storeName || l.pick.storeName, priceText: l.priceText ?? l.pick.priceText },
        imageUrl: l.pick.imageUrl, color: l.color, size: l.size, quantity: l.quantity, purchaseDate,
      });
      batchId = r.batchId; count += r.entryIds.length;
    }
    revalidatePath("/add");
    return { ok: true, value: { batchId, count, skipped } };
  } catch (e) { return fail(e); }
}

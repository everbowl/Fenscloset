import { db } from "@/lib/db";
import { deleteObject, newKey, putObject } from "@/lib/storage";
import { fetchImage, readProductPage } from "@/lib/shop/page";
import { searchProducts, type Product } from "@/lib/shop/products";
import { catalogBrand } from "@/lib/brands/catalog";
import { createEntry } from "@/lib/lists/service";
import { isMockAi, structured } from "@/lib/ai/claude";
import { loadTagLists, type Named, type TagResult } from "@/lib/ai/tag-item";
import type { EntryAiResult } from "@/lib/import/process";
import { ItemError } from "@/lib/items/service";
import { priceNumber, storeIdByName, type StoreMeta } from "@/lib/store/add";

/**
 * Style match (Jeff, 19 Oct 2026): once a brand is on a piece, find the same style at the store so
 * the closet gets the details (store, price, link, fabric, fit notes) and the store's photos sit
 * behind the person's own photo. The search carries only brand and product words, never the person.
 */

export type StyleProbe = { brand: string; name: string; category?: string | null; color?: string | null };
export const MAX_MATCHES = 6;
export const MAX_RETAIL_PHOTOS = 3;

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** Candidates for "Is it this one?": the brand's own store first, then anything with the brand in the title. */
export async function findStyleMatches(probe: StyleProbe): Promise<Product[]> {
  const brand = probe.brand.trim();
  if (!brand) return [];
  const queries = [`${brand} ${probe.name}`.trim(), probe.category ? `${brand} ${probe.color ?? ""} ${probe.category}`.replace(/\s+/g, " ").trim() : ""].filter(Boolean);
  const hits = (await searchProducts(queries, { favoriteStores: [brand], favoriteBrands: [brand] })).filter((p) => p.imageUrl);
  const domain = catalogBrand(brand)?.domain ?? null;
  const b = brand.toLowerCase();
  const score = (p: Product) => (domain && host(p.url).endsWith(domain.split(".").slice(-2).join(".")) ? 2 : 0) + (p.title.toLowerCase().includes(b) || p.storeName.toLowerCase().includes(b) ? 1 : 0);
  return hits.map((p, i) => ({ p, i, s: score(p) })).sort((a, b2) => b2.s - a.s || a.i - b2.i).map((x) => x.p).slice(0, MAX_MATCHES);
}

/** The brand by name from the family's list, or a new entry in it (store link from the catalog when known). */
export async function ensureBrand(name: string): Promise<Named & { url: string | null }> {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new ItemError("Type a brand name.");
  const found = await db.brand.findFirst({ where: { name: { equals: clean, mode: "insensitive" } }, select: { id: true, name: true, url: true } });
  const cat = catalogBrand(clean);
  if (found) {
    if (found.url || !cat) return found;
    const url = `https://www.${cat.domain}`; // a brand already in the list gets its store link filled in once
    await db.brand.update({ where: { id: found.id }, data: { url } });
    return { ...found, url };
  }
  const made = await createEntry("brand", { name: cat?.name ?? clean, url: cat ? `https://www.${cat.domain}` : null });
  return { id: made.id, name: made.name, url: cat ? `https://www.${cat.domain}` : null };
}

export type MatchDetails = { fabric: string | null; fitNotes: string | null };

/** Fabric and a one-line fit note read off the store's description (Claude), or nothing. */
export async function detailsFromDescription(title: string, description: string | null, fabrics: Named[]): Promise<MatchDetails> {
  if (!description?.trim()) return { fabric: null, fitNotes: null };
  if (isMockAi()) return { fabric: null, fitNotes: description.split(/(?<=[.!?])\s/)[0].slice(0, 120) };
  try {
    const out = await structured<{ fabric: string; fitNotes: string | null }>({
      system: "You read a store's product description for a private wardrobe app. Answer with JSON only.",
      prompt: `Product: ${title}\nDescription: ${description.slice(0, 1500)}\n\nGive the main fabric (one of the allowed names, or "unknown") and one short line about cut and fit a person would want to remember (e.g. "Straight leg, mid-rise, 100% cotton", or null if the text says nothing about fit).`,
      schema: { type: "object", additionalProperties: false, required: ["fabric", "fitNotes"], properties: { fabric: { type: "string", enum: [...fabrics.map((f) => f.name), "unknown"] }, fitNotes: { type: ["string", "null"] } } },
      effort: "low",
    });
    const fabric = fabrics.find((f) => f.name.toLowerCase() === out.fabric.toLowerCase())?.name ?? null;
    return { fabric, fitNotes: out.fitNotes?.trim().slice(0, 160) || null };
  } catch { return { fabric: null, fitNotes: null }; }
}

/** Download the pick's photo and the page's main photo when different; keys under the owner's originals. */
async function saveRetailPhotos(ownerId: string, urls: (string | null | undefined)[]): Promise<string[]> {
  const keys: string[] = [];
  for (const u of [...new Set(urls.filter((x): x is string => Boolean(x)))].slice(0, MAX_RETAIL_PHOTOS)) {
    const img = await fetchImage(u);
    if (!img) continue;
    const key = newKey("originals", ownerId, img.contentType);
    await putObject(key, img.data, img.contentType);
    keys.push(key);
  }
  return keys;
}

export type EntryMatchResult = { tags: TagResult; retailKeys: string[]; store: string; priceText: string | null; fitNotes: string | null };

/** "This one" on the confirm card: details onto the entry, store photos parked as retailKeys for the item. */
export async function applyStyleMatchToEntry(personId: string, entryId: string, pick: Product, brandName?: string | null): Promise<EntryMatchResult> {
  const entry = await db.importEntry.findUnique({ where: { id: entryId }, include: { batch: true } });
  if (!entry || entry.batch.personId !== personId) throw new ItemError("Not yours.", 403);
  const ai = (entry.aiResult as EntryAiResult | null);
  if (!ai) throw new ItemError("This photo is still being tagged.", 409);
  const page = await readProductPage(pick.url).catch(() => null);
  const lists = await loadTagLists();
  const brand = await ensureBrand(brandName?.trim() || ai.tags.brandText || (await db.brand.findUnique({ where: { id: ai.tags.brandId ?? "" }, select: { name: true } }))?.name || page?.brandText || pick.storeName);
  const details = await detailsFromDescription(pick.title, page?.description ?? null, lists.fabrics);
  const fabricId = !ai.tags.fabricId && details.fabric ? lists.fabrics.find((f) => f.name === details.fabric)?.id ?? null : ai.tags.fabricId;
  const retailKeys = await saveRetailPhotos(personId, [pick.imageUrl, page?.imageUrl]);
  for (const old of entry.retailKeys) await deleteObject(old).catch(() => undefined);
  const prev = (entry.storeMeta as StoreMeta | null) ?? null;
  const meta: StoreMeta = {
    name: ai.tags.name, brandText: brand.name, storeName: pick.storeName.slice(0, 60) || "Store", priceText: pick.priceText ?? page?.priceText ?? prev?.priceText ?? null,
    url: page?.url ?? pick.url, imageUrl: prev?.imageUrl ?? null, color: prev?.color ?? null, size: prev?.size ?? null, purchaseDate: prev?.purchaseDate ?? null,
    matched: true, fitNotes: details.fitNotes, matchTitle: pick.title.slice(0, 120),
  };
  const tags: TagResult = { ...ai.tags, brandId: brand.id, brandText: brand.name, fabricId, fabricConfidence: fabricId && fabricId !== ai.tags.fabricId ? 1 : ai.tags.fabricConfidence };
  await db.importEntry.update({ where: { id: entryId }, data: { retailKeys, storeMeta: JSON.parse(JSON.stringify(meta)), aiResult: JSON.parse(JSON.stringify({ ...ai, tags, edited: [...new Set([...(ai.edited ?? []), "brandId", "brandText", ...(fabricId !== ai.tags.fabricId ? ["fabricId"] : [])])] })) } });
  return { tags, retailKeys, store: meta.storeName, priceText: meta.priceText, fitNotes: details.fitNotes };
}

export type ItemMatchResult = { photos: { id: string; key: string }[]; store: string; priceText: string | null; fitNotes: string | null; brandId: string; brandName: string };

/** "This one" on a saved piece: fill brand, store, link, price, fabric and fit notes (blanks only, brand always), add the store photos behind the person's own. */
export async function applyStyleMatchToItem(viewer: { id: string; role: string }, itemId: string, pick: Product, brandName?: string | null): Promise<ItemMatchResult> {
  const item = await db.item.findUnique({ where: { id: itemId }, include: { brand: true, fabrics: { select: { id: true } }, photos: { where: { kind: "retail" } } } });
  if (!item) throw new ItemError("That piece is gone.", 404);
  if (item.ownerId !== viewer.id && viewer.role !== "admin") throw new ItemError("Not yours.", 403);
  const page = await readProductPage(pick.url).catch(() => null);
  const lists = await loadTagLists();
  const brand = await ensureBrand(brandName?.trim() || item.brand?.name || page?.brandText || pick.storeName);
  const details = await detailsFromDescription(pick.title, page?.description ?? null, lists.fabrics);
  const fabricId = !item.fabrics.length && details.fabric ? lists.fabrics.find((f) => f.name === details.fabric)?.id ?? null : null;
  const keys = await saveRetailPhotos(item.ownerId, [pick.imageUrl, page?.imageUrl]);
  const storeId = await storeIdByName(pick.storeName.slice(0, 60) || "Store");
  const made = await db.$transaction(async (tx) => {
    await tx.itemPhoto.deleteMany({ where: { itemId, kind: "retail" } });
    await tx.item.update({
      where: { id: itemId },
      data: {
        brandId: brand.id, storeId,
        purchaseUrl: item.purchaseUrl ?? (page?.url ?? pick.url).slice(0, 500),
        purchasePrice: item.purchasePrice ?? priceNumber(pick.priceText ?? page?.priceText),
        fitNotes: item.fitNotes ?? details.fitNotes,
        ...(fabricId ? { fabrics: { connect: [{ id: fabricId }] } } : {}),
      },
    });
    const rows: { id: string; key: string }[] = [];
    for (const key of keys) rows.push({ id: (await tx.itemPhoto.create({ data: { itemId, kind: "retail", bucketKey: key } })).id, key });
    return rows;
  });
  for (const p of item.photos) await deleteObject(p.bucketKey).catch(() => {});
  return { photos: made, store: pick.storeName, priceText: pick.priceText ?? page?.priceText ?? null, fitNotes: item.fitNotes ?? details.fitNotes, brandId: brand.id, brandName: brand.name };
}

import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { newKey, objectExists, putObject } from "@/lib/storage";
import { drainQueue } from "@/lib/import/queue";
import { createStoreEntries, createStoreRows, findColorPhotos, lookupProduct, priceNumber, storeIdByName, storeNameFromUrl, wordsFromUrl } from "@/lib/store/add";
import { parseProductPage } from "@/lib/shop/page";
import { pendingAdds } from "@/lib/import/pending";
import { personalClosetId } from "@/lib/items/service";
import { afterEach, vi } from "vitest";
import { parseJsonLoose } from "@/lib/ai/claude";
import { matchReceipt, readReceipt } from "@/lib/store/receipt";
import { addItemPhoto, answerPhotoNudge, photoNudge } from "@/lib/items/service";
import type { EntryAiResult } from "@/lib/import/process";

describe("add from a store", () => {
  let averyId: string;
  beforeEach(async () => {
    await resetDb(); process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true"; process.env.MOCK_FETCH = "true"; process.env.MOCK_SERPER = "true";
    delete process.env.MOCK_REMOVE_BG_FAIL; delete process.env.MOCK_FETCH_BLOCKED;
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-store-"));
    await seed();
    averyId = (await db.person.findUniqueOrThrow({ where: { email: "avery@example.test" } })).id;
  });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.MOCK_SHOPIFY_TYPE; process.env.MOCK_FETCH = "true"; });

  it("reads a product link into a card with the page's colors, sizes and a photo per color", async () => {
    const p = await lookupProduct("https://mock.example/products/linen-blazer");
    expect(p.name).toBe("Linen Blazer");
    expect(p.brandText).toBe("Everlane");
    expect(p.storeName).toBe("Mock Store");
    expect(p.priceText).toBe("$128.00");
    expect(p.colors).toEqual(["Oatmeal", "Black"]);
    expect(p.sizes).toEqual(["S", "M", "L"]);
    expect(p.colorImages.Black).toBe("https://mock.example/blazer-black.jpg");
    expect(storeNameFromUrl("https://shop.lululemon.com/p/x")).toBe("Lululemon");
    expect(priceNumber("$1,128.50")).toBe("1128.50");
    expect(priceNumber(null)).toBeNull();
    await expect(lookupProduct("not a link")).rejects.toThrow(/link/);
    expect((await findColorPhotos({ name: "Linen Blazer", brandText: "Everlane" }, "Black")).length).toBeGreaterThan(0);
  });

  it("makes one entry per row with the store photo and a count; store facts beat the guess; the piece lands in the closet on its own with price, link, store, copies and the store-photo mark", async () => {
    const p = await lookupProduct("https://mock.example/products/linen-blazer");
    const r = await createStoreEntries(averyId, { product: p, imageUrl: p.colorImages.Black, color: "Black", size: "M", quantity: 2 });
    expect(r.entryIds).toHaveLength(1);
    expect(r.pieces).toBe(2);
    await drainQueue();
    const entries = await db.importEntry.findMany({ where: { id: { in: r.entryIds } } });
    expect(entries[0].status).toBe("done"); // C1 (owner, 3 Nov 2026): no confirm card for a piece with store facts
    expect(entries[0].quantity).toBe(2);
    expect(await objectExists(entries[0].originalKey)).toBe(true);
    const ai = entries[0].aiResult as EntryAiResult;
    expect(ai.tags.name).toBe("Linen Blazer");
    expect(ai.tags.brandText).toBe("Everlane");
    expect(ai.tags.sizeText).toBe("M");
    const black = await db.color.findFirstOrThrow({ where: { name: "Black" } });
    expect(ai.tags.colorIds).toEqual([black.id]);

    const full = await db.item.findUniqueOrThrow({ where: { id: entries[0].itemId! }, include: { store: true, photos: true } });
    expect(full.copies).toBe(2);
    expect(full.purchaseUrl).toBe("https://mock.example/products/linen-blazer");
    expect(String(full.purchasePrice)).toBe("128");
    expect(full.store?.name).toBe("Mock Store");
    expect(full.storePhoto).toBe(true);
    expect(full.size).toBe("M");
    expect(full.photos.some((ph) => ph.kind === "cutout" && ph.isPrimary)).toBe(true);
    // a second piece from the same store reuses the store entry in the Stores list
    await createStoreEntries(averyId, { product: p, imageUrl: p.colorImages.Oatmeal, color: "Oatmeal", size: "M", quantity: 1 });
    await drainQueue();
    expect(await db.store.count({ where: { name: "Mock Store" } })).toBe(1);
  });

  it("two pieces from a new store landing together share one Store row and one personal closet (review B A2.1)", async () => {
    const [a, b] = await Promise.all([storeIdByName("Brand New Shop"), storeIdByName("Brand New Shop")]);
    expect(a).toBe(b);
    expect(await db.store.count({ where: { name: "Brand New Shop" } })).toBe(1);
    expect(await storeIdByName("brand new shop")).toBe(a); // the Stores list is one entry per name, whatever the case
    const [c1, c2, c3] = await Promise.all([personalClosetId(averyId), personalClosetId(averyId), personalClosetId(averyId)]);
    expect(c1).toBe(c2); expect(c2).toBe(c3);
    expect(await db.closet.count({ where: { ownerId: averyId, kind: "personal" } })).toBe(1);
    // the real thing: two colors of one product added at once from a store not yet in the list
    const p = await lookupProduct("https://mock.example/products/linen-blazer");
    const product = { ...p, storeName: "Another New Store" };
    const r = await createStoreRows(averyId, product, [{ color: "Black", size: "M", quantity: 1, imageUrl: p.colorImages.Black }, { color: "Oatmeal", size: "M", quantity: 1, imageUrl: p.colorImages.Oatmeal }]);
    await drainQueue();
    const entries = await db.importEntry.findMany({ where: { id: { in: r.entryIds } } });
    expect(entries.map((e) => e.status)).toEqual(["done", "done"]);
    expect(await db.store.count({ where: { name: "Another New Store" } })).toBe(1);
  });

  it("a non-Shopify page (no /products/ handle) gives a card with no color or size choices and still lands", async () => {
    const p = await lookupProduct("https://mock.example/p/linen-blazer-123");
    expect(p.colors).toEqual([]); expect(p.sizes).toEqual([]); expect(p.colorImages).toEqual({});
    expect(p.category).toBeNull();
    expect(p.imageUrl).toBe("https://mock.example/blazer.jpg");
    const r = await createStoreEntries(averyId, { product: p, imageUrl: p.imageUrl, color: null, size: null, quantity: 1 });
    expect(r.noPhoto).toBe(0);
    await drainQueue();
    const e = await db.importEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] } });
    expect(e.status).toBe("done");
    expect((await db.item.findUniqueOrThrow({ where: { id: e.itemId! } })).categoryId).not.toBeNull(); // the tagger's guess
  });

  it("a Shopify product type the page knows becomes the piece's category (review B A2.2)", async () => {
    process.env.MOCK_SHOPIFY_TYPE = "Bottoms";
    const p = await lookupProduct("https://mock.example/products/linen-blazer");
    expect(p.category).toBe("Bottoms");
    const r = await createStoreEntries(averyId, { product: p, imageUrl: p.imageUrl, color: null, size: null, quantity: 1 });
    await drainQueue();
    const e = await db.importEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] } });
    const bottoms = await db.category.findFirstOrThrow({ where: { name: "Bottoms" } });
    expect((await db.item.findUniqueOrThrow({ where: { id: e.itemId! } })).categoryId).toBe(bottoms.id); // the store knew better than the mock's "Tops"
  });

  it("a page with no og:image gives a card with no photo; the piece is still kept, with a stand-in picture and a word about it", async () => {
    const page = parseProductPage("https://mock.example/products/belt", `<html><head><title>Woven Belt | Mock Store</title><meta property="og:title" content="Woven Belt"><meta property="og:site_name" content="Mock Store"></head><body></body></html>`);
    expect(page.imageUrl).toBeNull();
    const product = { url: page.url, name: page.title!, brandText: null, storeName: page.siteName!, priceText: null };
    const r = await createStoreEntries(averyId, { product, imageUrl: page.imageUrl, color: "Black", size: null, quantity: 1 });
    expect(r.noPhoto).toBe(1);
    const before = await db.importEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] } });
    expect((before.storeMeta as { noPhoto?: boolean }).noPhoto).toBe(true);
    expect(await objectExists(before.originalKey)).toBe(true); // the stand-in card
    expect(before.thumbKey).toMatch(/^thumbs\//); // and its small picture for the Tagging card
    await drainQueue();
    const e = await db.importEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] } });
    expect(e.status).toBe("done");
    const ai = e.aiResult as EntryAiResult;
    expect(ai.warnings).toContain("no_store_photo");
    expect(ai.tags.name).toBe("Woven Belt");
    const black = await db.color.findFirstOrThrow({ where: { name: "Black" } });
    expect(ai.tags.colorIds).toEqual([black.id]); // the store's facts carry the piece; nothing was sent to the tagger
    const item = await db.item.findUniqueOrThrow({ where: { id: e.itemId! }, include: { photos: true } });
    expect(item.categoryId).toBeNull(); // no photo, no page category: it asks in the closet
    expect(item.storePhoto).toBe(true);
    expect(item.photos.some((ph) => ph.kind === "alone" && ph.isPrimary)).toBe(true);
    const pending = await pendingAdds(averyId);
    expect(pending.cards.map((c) => [c.status, c.itemId, c.noPhoto])).toEqual([["needs_category", item.id, true]]);
  });

  it("when the store's photo cannot be downloaded the add no longer fails: the piece is kept without a photo and the result says so", async () => {
    process.env.MOCK_FETCH = "false";
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 403 })); // the store refuses the hot-link
    const product = { url: "https://mock.example/products/linen-blazer", name: "Linen Blazer", brandText: "Everlane", storeName: "Mock Store", priceText: "$128.00", category: "Tops" };
    const r = await createStoreRows(averyId, product, [{ color: "Black", size: "M", quantity: 2, imageUrl: "https://mock.example/blazer-black.jpg" }, { color: "Oatmeal", size: "M", quantity: 1, imageUrl: "https://mock.example/blazer.jpg" }]);
    expect(r.pieces).toBe(3);
    expect(r.noPhoto).toBe(2);
    await drainQueue();
    const entries = await db.importEntry.findMany({ where: { id: { in: r.entryIds } }, orderBy: { order: "asc" } });
    expect(entries.map((e) => e.status)).toEqual(["done", "done"]);
    const items = await db.item.findMany({ where: { id: { in: entries.map((e) => e.itemId!) } } });
    const tops = await db.category.findFirstOrThrow({ where: { name: "Tops" } });
    expect(items.map((it) => it.categoryId)).toEqual([tops.id, tops.id]); // the page's category carries the piece even with no picture
    expect(items.map((it) => it.copies).sort()).toEqual([1, 2]);
  });

  it("nudges for your own photo after one wear on a store piece, and for a fresh one every six wears on any piece", async () => {
    expect(photoNudge({ storePhoto: true, wearCount: 0, photoNudgedAt: null })).toBeNull();
    expect(photoNudge({ storePhoto: true, wearCount: 1, photoNudgedAt: null })).toBe("first");
    expect(photoNudge({ storePhoto: true, wearCount: 3, photoNudgedAt: 1 })).toBeNull();
    expect(photoNudge({ storePhoto: false, wearCount: 5, photoNudgedAt: null })).toBeNull();
    expect(photoNudge({ storePhoto: false, wearCount: 6, photoNudgedAt: null })).toBe("refresh");
    expect(photoNudge({ storePhoto: false, wearCount: 11, photoNudgedAt: 6 })).toBeNull();
    expect(photoNudge({ storePhoto: false, wearCount: 12, photoNudgedAt: 6 })).toBe("refresh");
    expect(photoNudge({ storePhoto: true, wearCount: 7, photoNudgedAt: 1 })).toBe("refresh");

    const p = await lookupProduct("https://mock.example/products/linen-blazer");
    const r = await createStoreEntries(averyId, { product: p, imageUrl: p.imageUrl, color: null, size: null, quantity: 1 });
    await drainQueue();
    const item = { id: (await db.importEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] } })).itemId! }; // auto-added (C1)
    await db.item.update({ where: { id: item.id }, data: { wearCount: 1 } });
    const viewer = { id: averyId, role: "admin" };
    await answerPhotoNudge(viewer, item.id);
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).photoNudgedAt).toBe(1);
    // your own hanger photo replaces the store photo as the photo of record
    const key = newKey("originals", averyId, "image/jpeg");
    await putObject(key, await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 10, g: 10, b: 10 } } }).jpeg().toBuffer(), "image/jpeg");
    await addItemPhoto(viewer, item.id, "alone", key);
    const after = await db.item.findUniqueOrThrow({ where: { id: item.id }, include: { photos: true } });
    expect(after.storePhoto).toBe(false);
    expect(after.photos.filter((ph) => ph.isPrimary).map((ph) => ph.bucketKey)).toEqual([key]);
  });

  it("reads a receipt into lines and matches each to product pictures; a line names one of the family's categories when it can", async () => {
    const receipt = await readReceipt({ data: "", mediaType: "image/jpeg" }, ["Tops", "Bottoms"]);
    expect(receipt.storeName).toBe("Mock Store");
    expect(receipt.orderDate).toBe("2026-10-12");
    expect(receipt.lines).toHaveLength(2);
    expect(receipt.lines.map((l) => l.category)).toEqual([null, "Tops"]); // "Outerwear" is not in this family's list; the tee is Tops
    expect((await readReceipt({ data: "", mediaType: "image/jpeg" })).lines.every((l) => l.category === null)).toBe(true);
    const lines = await matchReceipt(receipt);
    // line 1 has its link on the receipt: the exact item, with the store's photo for its color, comes first
    expect(lines[0].picks[0].query).toBe("exact");
    expect(lines[0].picks[0].url).toBe("https://mock.example/products/linen-blazer");
    expect(lines[0].picks[0].imageUrl).toBe("https://mock.example/blazer.jpg"); // Oatmeal
    // line 2 has no link: the store's page is found by search, then the shopping alternatives follow
    expect(lines[1].picks[0].query).toBe("exact");
    expect(lines[1].picks[0].imageUrl).toBe("https://mock.example/blazer-black.jpg"); // Black
    expect(lines[1].picks.length).toBeGreaterThan(1);
    expect(lines[1].quantity).toBe(2);
    const r = await createStoreEntries(averyId, { product: { url: lines[1].picks[0].url, name: lines[1].name, brandText: null, storeName: receipt.storeName!, priceText: lines[1].priceText, category: lines[1].category }, imageUrl: lines[1].picks[0].imageUrl, color: lines[1].color, size: lines[1].size, quantity: lines[1].quantity, purchaseDate: receipt.orderDate });
    await drainQueue();
    const entry = await db.importEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] } });
    const full = await db.item.findUniqueOrThrow({ where: { id: entry.itemId! } });
    expect(full.copies).toBe(2); // the receipt line said ×2
    expect(full.purchaseDate?.toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(String(full.purchasePrice)).toBe("38");
  });

  it("a store that blocks link previews falls back to a product search on the link's words", async () => {
    expect(wordsFromUrl("https://shop.lululemon.com/p/mens-t-shirts/Metal-Vent-Tech-Short-Sleeve-Shirt/_/prod10550086?color=31382")).toBe("mens t shirts Metal Vent Tech Short Sleeve Shirt");
    expect(wordsFromUrl("https://www.nike.com/t/dri-fit-mens-training-top-abc123/DV9839-010")).toBe("t dri fit mens training top");
    process.env.MOCK_FETCH_BLOCKED = "true";
    const p = await lookupProduct("https://shop.lululemon.com/p/mens-t-shirts/Metal-Vent-Tech-Short-Sleeve-Shirt/_/prod10550086");
    expect(p.source).toBe("search");
    expect(p.storeName).toBe("Lululemon");
    expect(p.name).toMatch(/Metal Vent Tech/);
    expect(p.imageUrl).toMatch(/^https:\/\/mock\.example\/img\//);
    expect(p.colors).toEqual([]);
    process.env.MOCK_SERPER = "false"; delete process.env.SERPER_API_KEY;
    await expect(lookupProduct("https://shop.lululemon.com/p/mens-t-shirts/Metal-Vent-Tech-Short-Sleeve-Shirt/_/prod10550086")).rejects.toThrow(/Lululemon blocks link previews/);
    process.env.MOCK_SERPER = "true";
  });

  it("loose JSON parsing recovers an answer wrapped in a sentence or a code fence", () => {
    expect(parseJsonLoose<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose<{ a: number }>('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose<{ a: number }>('Sure. {"a":1} Hope that helps.')).toEqual({ a: 1 });
    expect(parseJsonLoose('no json here')).toBeUndefined();
  });

  it("rows of one product at once (the bulk add): each color and size gets its pieces in one batch, rows with no count are skipped", async () => {
    const product = { url: "https://mock.example/products/linen-blazer", name: "Linen Blazer", brandText: "Everlane", storeName: "Mock Store", priceText: "$128.00" };
    const r = await createStoreRows(averyId, product, [
      { color: "Black", size: "M", quantity: 2, imageUrl: "https://mock.example/blazer-black.jpg" },
      { color: "Oatmeal", size: null, quantity: 0, imageUrl: "https://mock.example/blazer.jpg" },
      { color: "Oatmeal", size: "L", quantity: 1, imageUrl: "https://mock.example/blazer.jpg" },
    ]);
    expect(r.entryIds).toHaveLength(2);
    expect(r.pieces).toBe(3);
    const entries = await db.importEntry.findMany({ where: { id: { in: r.entryIds } }, orderBy: { order: "asc" } });
    expect(entries.every((e) => e.batchId === r.batchId)).toBe(true);
    expect(entries.map((e) => [(e.storeMeta as { color: string }).color, e.quantity])).toEqual([["Black", 2], ["Oatmeal", 1]]);
    expect((entries[1].storeMeta as { size: string }).size).toBe("L");
    await expect(createStoreRows(averyId, product, [{ color: "Black", size: null, quantity: 0, imageUrl: null }])).rejects.toThrow(/how many/);
  });
});

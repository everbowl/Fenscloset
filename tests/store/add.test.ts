import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { newKey, objectExists, putObject } from "@/lib/storage";
import { drainQueue } from "@/lib/import/queue";
import { createStoreEntries, findColorPhotos, lookupProduct, priceNumber, storeNameFromUrl } from "@/lib/store/add";
import { matchReceipt, readReceipt } from "@/lib/store/receipt";
import { addItemPhoto, answerPhotoNudge, createItemFromEntry, photoNudge } from "@/lib/items/service";
import type { EntryAiResult } from "@/lib/import/process";

describe("add from a store", () => {
  let jeffId: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true"; process.env.MOCK_FETCH = "true"; process.env.MOCK_SERPER = "true";
    delete process.env.MOCK_REMOVE_BG_FAIL;
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-store-"));
    await seed();
    jeffId = (await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } })).id;
  });

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

  it("makes one entry per piece with the store photo; store facts beat the guess; the item gets price, link, store and the store-photo mark", async () => {
    const p = await lookupProduct("https://mock.example/products/linen-blazer");
    const r = await createStoreEntries(jeffId, { product: p, imageUrl: p.colorImages.Black, color: "Black", size: "M", quantity: 2 });
    expect(r.entryIds).toHaveLength(2);
    await drainQueue();
    const entries = await db.importEntry.findMany({ where: { id: { in: r.entryIds } } });
    expect(entries.every((e) => e.status === "needs_confirm")).toBe(true);
    expect(new Set(entries.map((e) => e.originalKey)).size).toBe(2);
    expect(await objectExists(entries[0].originalKey)).toBe(true);
    const ai = entries[0].aiResult as EntryAiResult;
    expect(ai.tags.name).toBe("Linen Blazer");
    expect(ai.tags.brandText).toBe("Everlane");
    expect(ai.tags.sizeText).toBe("M");
    const black = await db.color.findFirstOrThrow({ where: { name: "Black" } });
    expect(ai.tags.colorIds).toEqual([black.id]);

    const item = await createItemFromEntry(jeffId, entries[0].id);
    const full = await db.item.findUniqueOrThrow({ where: { id: item.id }, include: { store: true, photos: true } });
    expect(full.purchaseUrl).toBe("https://mock.example/products/linen-blazer");
    expect(String(full.purchasePrice)).toBe("128");
    expect(full.store?.name).toBe("Mock Store");
    expect(full.storePhoto).toBe(true);
    expect(full.size).toBe("M");
    expect(full.photos.some((ph) => ph.kind === "cutout" && ph.isPrimary)).toBe(true);
    // a second piece from the same store reuses the store entry in the Stores list
    await createItemFromEntry(jeffId, entries[1].id);
    expect(await db.store.count({ where: { name: "Mock Store" } })).toBe(1);
    await expect(createStoreEntries(jeffId, { product: p, imageUrl: null, color: null, size: null, quantity: 1 })).rejects.toThrow(/photo/);
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
    const r = await createStoreEntries(jeffId, { product: p, imageUrl: p.imageUrl, color: null, size: null, quantity: 1 });
    await drainQueue();
    const item = await createItemFromEntry(jeffId, r.entryIds[0]);
    await db.item.update({ where: { id: item.id }, data: { wearCount: 1 } });
    const viewer = { id: jeffId, role: "admin" };
    await answerPhotoNudge(viewer, item.id);
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).photoNudgedAt).toBe(1);
    // your own hanger photo replaces the store photo as the photo of record
    const key = newKey("originals", jeffId, "image/jpeg");
    await putObject(key, await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 10, g: 10, b: 10 } } }).jpeg().toBuffer(), "image/jpeg");
    await addItemPhoto(viewer, item.id, "alone", key);
    const after = await db.item.findUniqueOrThrow({ where: { id: item.id }, include: { photos: true } });
    expect(after.storePhoto).toBe(false);
    expect(after.photos.filter((ph) => ph.isPrimary).map((ph) => ph.bucketKey)).toEqual([key]);
  });

  it("reads a receipt into lines and matches each to product pictures", async () => {
    const receipt = await readReceipt({ data: "", mediaType: "image/jpeg" });
    expect(receipt.storeName).toBe("Mock Store");
    expect(receipt.orderDate).toBe("2026-10-12");
    expect(receipt.lines).toHaveLength(2);
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
    const r = await createStoreEntries(jeffId, { product: { url: lines[1].picks[0].url, name: lines[1].name, brandText: null, storeName: receipt.storeName!, priceText: lines[1].priceText }, imageUrl: lines[1].picks[0].imageUrl, color: lines[1].color, size: lines[1].size, quantity: lines[1].quantity, purchaseDate: receipt.orderDate });
    await drainQueue();
    const item = await createItemFromEntry(jeffId, r.entryIds[0]);
    const full = await db.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(full.purchaseDate?.toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(String(full.purchasePrice)).toBe("38");
  });
});

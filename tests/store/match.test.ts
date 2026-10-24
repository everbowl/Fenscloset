import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { newKey, objectExists, putObject } from "@/lib/storage";
import { getOrCreateOpenBatch, registerEntry } from "@/lib/import/service";
import { drainQueue } from "@/lib/import/queue";
import { createItemFromEntry } from "@/lib/items/service";
import { applyStyleMatchToEntry, applyStyleMatchToItem, ensureBrand, findStyleMatches } from "@/lib/store/match";
import { catalogBrand, searchCatalog } from "@/lib/brands/catalog";
import type { Product } from "@/lib/shop/products";

const pick: Product = { title: "Nike Dri-FIT Tee", priceText: "$35.00", storeName: "Nike", url: "https://www.nike.com/t/dri-fit-tee", imageUrl: "https://mock.example/img/1.jpg", query: "nike tee" };

describe("brand catalog", () => {
  it("narrows as you type: starts-with first, then contains; exact name gives the store domain", () => {
    expect(searchCatalog("lu").map((b) => b.name).slice(0, 2)).toEqual(["Lucky Brand", "Lululemon"]);
    expect(searchCatalog("levi")[0].name).toBe("Levi's");
    expect(searchCatalog("north")[0].name).toBe("The North Face");
    expect(searchCatalog("")).toEqual([]);
    expect(catalogBrand("7 for all mankind")?.domain).toBe("7forallmankind.com");
    expect(catalogBrand("No Such Brand")).toBeNull();
  });
});

describe("style match", () => {
  let jeffId: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true"; process.env.MOCK_SERPER = "true"; process.env.MOCK_FETCH = "true";
    delete process.env.MOCK_REMOVE_BG_FAIL; delete process.env.MOCK_ORIENTATION;
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-match-"));
    await seed();
    jeffId = (await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } })).id;
  });

  async function readyEntry() {
    const b = await getOrCreateOpenBatch(jeffId, 1);
    const key = newKey("originals", jeffId, "image/jpeg");
    await putObject(key, await sharp({ create: { width: 500, height: 700, channels: 3, background: { r: 40, g: 30, b: 30 } } }).jpeg().toBuffer(), "image/jpeg");
    const e = await registerEntry(jeffId, b.id, key, 0);
    await drainQueue();
    return db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
  }

  it("ensureBrand reuses the family's brand (any case) or adds it with the catalog's store link", async () => {
    const nike = await ensureBrand("nike");
    expect(nike.name).toBe("Nike");
    expect(await db.brand.count({ where: { name: "Nike" } })).toBe(1);
    const vuori = await ensureBrand("vuori");
    expect(vuori.url).toBe("https://www.vuoriclothing.com");
    const custom = await ensureBrand("Jeff's Garage Brand");
    expect(custom.url).toBeNull();
    expect((await db.brand.findUniqueOrThrow({ where: { id: custom.id } })).name).toBe("Jeff's Garage Brand");
  });

  it("findStyleMatches asks the shop for brand + name and brand + color + type, pictures only, six at most", async () => {
    const rows = await findStyleMatches({ brand: "Nike", name: "black crew tee", category: "Tops", color: "Black" });
    expect(rows.length).toBe(6);
    expect(rows.every((r) => r.imageUrl)).toBe(true);
    expect(rows[0].title).toMatch(/Nike/);
    expect(await findStyleMatches({ brand: "", name: "x" })).toEqual([]);
  });

  it("'This one' on the card: brand, store, price, link, fit notes onto the entry; store photos ride onto the item behind the real photo", async () => {
    const e = await readyEntry();
    const r = await applyStyleMatchToEntry(jeffId, e.id, pick, "Nike");
    expect(r.retailKeys.length).toBe(2); // the pick's picture and the page's main picture
    expect(r.tags.brandText).toBe("Nike");
    expect(r.store).toBe("Nike");
    expect(r.fitNotes).toBe("A breezy linen blazer in oatmeal.");
    const after = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.retailKeys).toEqual(r.retailKeys);
    const item = await createItemFromEntry(jeffId, e.id);
    const full = await db.item.findUniqueOrThrow({ where: { id: item.id }, include: { photos: true, brand: true, store: true } });
    expect(full.brand?.name).toBe("Nike");
    expect(full.store?.name).toBe("Nike");
    expect(full.purchaseUrl).toBe("https://www.nike.com/t/dri-fit-tee");
    expect(String(full.purchasePrice)).toBe("35");
    expect(full.fitNotes).toBe("A breezy linen blazer in oatmeal.");
    expect(full.storePhoto).toBe(false); // the person's own photo stays the photo of record
    expect(full.photos.filter((p) => p.kind === "retail").length).toBe(2);
    expect(full.photos.find((p) => p.isPrimary)?.kind).toBe("cutout");
    // matching again replaces the parked store photos
    const e2 = await readyEntry();
    const first = await applyStyleMatchToEntry(jeffId, e2.id, pick);
    const second = await applyStyleMatchToEntry(jeffId, e2.id, { ...pick, imageUrl: "https://mock.example/img/9.jpg" });
    expect(await objectExists(first.retailKeys[0])).toBe(false);
    expect(await objectExists(second.retailKeys[0])).toBe(true);
    // not yours
    const other = await db.person.create({ data: { name: "Other", email: "other@example.com", role: "member" } });
    await expect(applyStyleMatchToEntry(other.id, e2.id, pick)).rejects.toMatchObject({ status: 403 });
  });

  it("'This one' on a saved piece fills the blanks, keeps what was typed, and swaps the store photos", async () => {
    const e = await readyEntry();
    const item = await createItemFromEntry(jeffId, e.id, { fitNotes: undefined } as never);
    await db.item.update({ where: { id: item.id }, data: { fitNotes: "Runs small" } });
    const r = await applyStyleMatchToItem({ id: jeffId, role: "admin" }, item.id, pick, "Nike");
    expect(r.photos.length).toBe(2);
    expect(r.brandName).toBe("Nike");
    const full = await db.item.findUniqueOrThrow({ where: { id: item.id }, include: { photos: true, store: true } });
    expect(full.fitNotes).toBe("Runs small");
    expect(full.store?.name).toBe("Nike");
    expect(full.purchaseUrl).toBe("https://www.nike.com/t/dri-fit-tee");
    expect(full.photos.filter((p) => p.kind === "retail").length).toBe(2);
    const again = await applyStyleMatchToItem({ id: jeffId, role: "admin" }, item.id, { ...pick, imageUrl: "https://mock.example/img/7.jpg" });
    expect(await objectExists(r.photos[0].key)).toBe(false);
    expect(await objectExists(again.photos[0].key)).toBe(true);
    expect(await db.itemPhoto.count({ where: { itemId: item.id, kind: "retail" } })).toBe(2);
    const stranger = await db.person.create({ data: { name: "Other", email: "other@example.com", role: "member" } });
    await expect(applyStyleMatchToItem({ id: stranger.id, role: "member" }, item.id, pick)).rejects.toMatchObject({ status: 403 });
  });
});

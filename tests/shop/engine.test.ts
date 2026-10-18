import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { personalClosetId } from "@/lib/items/service";
import { parseProductPage, normalizeUrl, MOCK_PAGE } from "@/lib/shop/page";
import { deleteLookup, getLookup, listRecent, lookup } from "@/lib/shop/engine";
import { canViewKey } from "@/lib/photos/visibility";

async function addItem(ownerId: string, name: string, category: string, color?: string) {
  const cat = await db.category.findFirstOrThrow({ where: { name: category } });
  const col = color ? await db.color.findFirstOrThrow({ where: { name: color } }) : null;
  return db.item.create({ data: { ownerId, name, categoryId: cat.id, closets: { create: [{ closetId: await personalClosetId(ownerId) }] }, ...(col ? { colors: { connect: [{ id: col.id }] } } : {}) } });
}

describe("shop", () => {
  beforeEach(async () => {
    await resetDb(); process.env.MOCK_S3 = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_FETCH = "true"; process.env.MOCK_SERPER = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-shop-")); await seed();
  });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });

  it("parses a store page (OG / price / brand) and rejects non-store links", () => {
    const p = parseProductPage("https://mock.example/p/1", MOCK_PAGE);
    expect(p).toMatchObject({ title: "Linen Blazer", priceText: "$128.00", brandText: "Everlane", imageUrl: "https://mock.example/blazer.jpg" });
    expect(() => normalizeUrl("not a link")).toThrow();
    expect(() => normalizeUrl("http://localhost:3000/x")).toThrow();
    expect(normalizeUrl("everlane.com/products/blazer").toString()).toBe("https://everlane.com/products/blazer");
  });

  it("link lookup: verdict, similar-owned, pairings with the candidate as hero, recommendations; permissions; photo visibility", async () => {
    const [jeff, olivia, mya, brittney] = await Promise.all([by("Jeff"), by("Olivia"), by("Mya"), by("Brittney")]);
    await addItem(jeff.id, "Dark jeans", "Bottoms", "Navy");
    await addItem(jeff.id, "White tee", "Tops", "White");
    const v = await lookup(jeff, jeff.id, { source: "link", url: "https://mock.example/p/1" });
    expect(v.title).toBe("Linen Blazer");
    expect(v.priceText).toBe("$128.00");
    expect(v.verdict.call).toBe("FITS");
    expect(v.read.categoryName).toBe("Outerwear");
    expect(v.pairings.length).toBeGreaterThan(0);
    expect(v.pairings[0].pieces[0].id).toBe("candidate");
    expect(v.pairings[0].pieces[0].thumbKey).toMatch(/^shop\//);
    expect(v.recommendations).toEqual([]); // FITS and nothing missing
    expect(v.products).toEqual([]);
    expect(await canViewKey(jeff, v.imageKey!)).toBe(true);
    expect(await canViewKey(olivia, v.imageKey!)).toBe(false);
    // PASS when two similar pieces are owned → recommendations appear (favorite store search links)
    const beige = (await db.color.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" } })).find((c) => /beige|cream|tan|oat/i.test(c.name))!; // same pick as the mock reader
    await db.item.create({ data: { ownerId: jeff.id, name: "Blazer one", categoryId: (await db.category.findFirstOrThrow({ where: { name: "Outerwear" } })).id, colors: { connect: [{ id: beige.id }] } } });
    await db.item.create({ data: { ownerId: jeff.id, name: "Blazer two", categoryId: (await db.category.findFirstOrThrow({ where: { name: "Outerwear" } })).id, colors: { connect: [{ id: beige.id }] } } });
    const nordstrom = await db.store.findFirst({ where: { url: { not: null } } });
    await db.person.update({ where: { id: jeff.id }, data: { favoriteStores: { connect: nordstrom ? [{ id: nordstrom.id }] : [] } } });
    const v2 = await lookup(jeff, jeff.id, { source: "link", url: "https://mock.example/p/1" });
    expect(v2.verdict.call).toBe("PASS");
    expect(v2.similar.map((s) => s.name).sort()).toEqual(["Blazer one", "Blazer two"]);
    expect(v2.recommendations.length).toBeGreaterThan(0);
    expect(v2.recommendations[0].url).toMatch(/^https:\/\//);
    // PASS → real products for the alternative query, favorite store first
    expect(v2.verdict.shoppingQueries.length).toBeGreaterThan(0);
    expect(v2.products.length).toBeGreaterThan(0);
    expect(v2.products[0]).toMatchObject({ storeName: "Nordstrom", url: expect.stringMatching(/^https:\/\//) });
    expect((await getLookup(jeff, v2.id))!.products.length).toBe(v2.products.length);
    // permissions: Olivia cannot shop for Mya; Jeff (parent) can, and body data is used for Mya; Brittney shopping for Jeff gets no body data
    await expect(lookup(olivia, mya.id, { source: "link", url: "https://mock.example/p/1" })).rejects.toMatchObject({ status: 403 });
    const img = await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 20, g: 20, b: 20 } } }).jpeg().toBuffer();
    await addItem(mya.id, "Mya jeans", "Bottoms", "Navy");
    const kinds = await db.measurementKind.findMany();
    await db.bodyMeasurement.create({ data: { personId: mya.id, kindId: kinds[0].id, value: "60" } });
    const forMya = await lookup(jeff, mya.id, { source: "photo", data: img, contentType: "image/jpeg" });
    expect(forMya.verdict.usedBodyData).toBe(true);
    expect(forMya.products).toEqual([]); // she owns bottoms: nothing missing
    expect(forMya.forName).toBe("Mya");
    expect(await canViewKey(mya, forMya.imageKey!)).toBe(true);
    expect(await canViewKey(brittney, forMya.imageKey!)).toBe(true);
    await db.bodyMeasurement.create({ data: { personId: jeff.id, kindId: kinds[0].id, value: "70" } });
    await db.shopForGrant.create({ data: { ownerId: jeff.id, shopperId: brittney.id } });
    const byB = await lookup(brittney, jeff.id, { source: "screenshot", data: img, contentType: "image/jpeg" });
    expect(byB.verdict.usedBodyData).toBe(false);
    // recent + delete
    expect((await listRecent(jeff, jeff.id)).length).toBe(3);
    await expect(deleteLookup(olivia, v.id)).rejects.toMatchObject({ status: 403 });
    await deleteLookup(jeff, v.id);
    expect(await getLookup(jeff, v.id)).toBeNull();
  });
});

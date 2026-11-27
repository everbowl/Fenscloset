import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { newKey, putObject } from "@/lib/storage";
import { getOrCreateOpenBatch, registerEntry } from "@/lib/import/service";
import { drainQueue } from "@/lib/import/queue";
import { createItemFromEntry } from "@/lib/items/service";
import { listMyBrands, removeMyBrand, setMyBrand, sizeFor } from "@/lib/profiles/brands";
import { likelySizes, sizeOptionsByCategory } from "@/lib/profiles/sizes";
import { formatMeasurement, likelyFor, measurementOptions } from "@/lib/profiles/size-options";
import { setMeasurement } from "@/lib/profiles/service";

describe("my brands & sizes by item type", () => {
  beforeEach(async () => {
    await resetDb(); process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-mybrands-"));
    await seed();
  });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });
  const cat = (n: string) => db.category.findFirstOrThrow({ where: { name: n } });

  it("size options come per category from the editable list", async () => {
    const opts = await sizeOptionsByCategory();
    const tops = opts.find((o) => o.categoryName === "Tops")!;
    expect(tops.options.slice(0, 6)).toEqual(["XS", "S", "M", "L", "XL", "XXL"]);
    expect(opts.find((o) => o.categoryName === "Bottoms")!.options).toContain("32");
    expect(opts.find((o) => o.categoryName === "Shoes")!.options).toContain("M 10.5 / W 12");
    expect(opts.find((o) => o.categoryName === "Jewelry")).toBeUndefined();
  });

  it("a brand holds one size per item type, plus the link; the pill picks the size for the piece's category", async () => {
    const [avery, casey, devon] = await Promise.all([by("Avery"), by("Casey"), by("Devon")]);
    const [lulu, nike] = await db.brand.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, take: 2 });
    const [tops, bottoms, shoes] = await Promise.all([cat("Tops"), cat("Bottoms"), cat("Shoes")]);
    expect(await listMyBrands(avery, avery.id)).toEqual([]);
    await setMyBrand(avery, avery.id, { brandId: lulu.id, url: "shop.lululemon.com", sizes: [{ categoryId: tops.id, size: " L " }, { categoryId: bottoms.id, size: "32" }] });
    await setMyBrand(avery, avery.id, { brandId: nike.id, sizes: [{ categoryId: shoes.id, size: "11" }] });
    const mine = await listMyBrands(avery, avery.id);
    const l = mine.find((b) => b.brandId === lulu.id)!;
    expect(l).toMatchObject({ url: "https://shop.lululemon.com/" });
    expect(l.sizes.map((s) => [s.categoryName, s.size])).toEqual([["Tops", "L"], ["Bottoms", "32"]]);
    expect(sizeFor(l, tops.id)).toBe("L");
    expect(sizeFor(l, bottoms.id)).toBe("32");
    expect(sizeFor(l, shoes.id)).toBeNull(); // two sizes, neither for shoes: no guess
    expect(sizeFor(mine.find((b) => b.brandId === nike.id)!, tops.id)).toBe("11"); // one size only: offered anyway
    // clear one type; the link stays unless cleared on purpose
    await setMyBrand(avery, avery.id, { brandId: lulu.id, url: null, sizes: [{ categoryId: bottoms.id, size: "" }] });
    expect((await listMyBrands(avery, avery.id)).find((b) => b.brandId === lulu.id)).toMatchObject({ url: "https://shop.lululemon.com/", sizes: [{ categoryName: "Tops", size: "L" }] });
    await setMyBrand(avery, avery.id, { brandId: lulu.id, url: "" });
    expect((await listMyBrands(avery, avery.id)).find((b) => b.brandId === lulu.id)).toMatchObject({ url: null });
    await expect(setMyBrand(avery, avery.id, { brandId: lulu.id, url: "not a link" })).rejects.toThrow(/link/);
    await removeMyBrand(avery, avery.id, lulu.id);
    expect((await listMyBrands(avery, avery.id)).map((b) => b.brandId)).toEqual([nike.id]);
    expect(await db.bodySizeByBrand.count({ where: { personId: avery.id, brandId: lulu.id } })).toBe(0);
    // minors: parent yes, sibling no; a sibling sees the brand but never the size (review E A1)
    await setMyBrand(avery, devon.id, { brandId: nike.id, sizes: [{ categoryId: tops.id, size: "Youth M" }] });
    expect((await listMyBrands(devon, devon.id))[0].sizes[0]).toMatchObject({ categoryName: "Tops", size: "Youth M" });
    expect((await listMyBrands(avery, devon.id))[0].sizes[0]).toMatchObject({ size: "Youth M" });
    expect(await listMyBrands(casey, devon.id)).toEqual([expect.objectContaining({ brandId: nike.id, sizes: [] })]);
    expect((await listMyBrands(casey, avery.id)).every((b) => b.sizes.length === 0)).toBe(true);
    await expect(setMyBrand(casey, devon.id, { brandId: lulu.id })).rejects.toMatchObject({ status: 403 });
    await expect(removeMyBrand(casey, devon.id, nike.id)).rejects.toMatchObject({ status: 403 });
    // a stale item type from an old sheet is refused; a member fills a blank brand link but does not change one that is set (G6)
    await expect(setMyBrand(avery, avery.id, { brandId: nike.id, sizes: [{ categoryId: "gone", size: "M" }] })).rejects.toThrow(/item type/);
    await setMyBrand(casey, casey.id, { brandId: lulu.id, url: "lululemon.com" }); // blank before: anyone may fill it
    await expect(setMyBrand(casey, casey.id, { brandId: lulu.id, url: "shop.lululemon.com" })).rejects.toMatchObject({ status: 403 });
    await setMyBrand(casey, casey.id, { brandId: lulu.id, url: null, sizes: [{ categoryId: tops.id, size: "S" }] }); // null leaves the link alone
    expect((await listMyBrands(casey, casey.id)).find((b) => b.brandId === lulu.id)).toMatchObject({ url: "https://lululemon.com/", sizes: [{ size: "S" }] });
  });

  it("a piece confirmed with one of my brands carries the brand link as its store link", async () => {
    const avery = await by("Avery");
    const lulu = await db.brand.findFirstOrThrow({ where: { isArchived: false } });
    await setMyBrand(avery, avery.id, { brandId: lulu.id, url: "https://shop.lululemon.com/", sizes: [{ categoryId: (await cat("Tops")).id, size: "M" }] });
    const b = await getOrCreateOpenBatch(avery.id, 1);
    const key = newKey("originals", avery.id, "image/jpeg");
    await putObject(key, await sharp({ create: { width: 500, height: 700, channels: 3, background: { r: 40, g: 30, b: 30 } } }).jpeg().toBuffer(), "image/jpeg");
    const e = await registerEntry(avery.id, b.id, key, 0);
    await drainQueue();
    const item = await createItemFromEntry(avery.id, e.id, { brandId: lulu.id, brandText: lulu.name, sizeText: "M" });
    expect(await db.item.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ brandId: lulu.id, size: "M", purchaseUrl: "https://shop.lululemon.com/", storePhoto: false });
  });

  it("likely sizes come from height and weight bands (adults only) and measurement pickers have preloaded options", async () => {
    const [avery, devon] = await Promise.all([by("Avery"), by("Devon")]);
    const kinds = await db.measurementKind.findMany();
    const height = kinds.find((k) => k.name === "Height")!, weight = kinds.find((k) => k.name === "Weight")!;
    expect(await likelySizes(avery.id)).toBeNull();
    await setMeasurement(avery, avery.id, height.id, "72");
    await setMeasurement(avery, avery.id, weight.id, "185");
    const l = (await likelySizes(avery.id))!;
    expect(l).toMatchObject({ letter: "L", dress: "12", from: { heightIn: 72, weightLb: 185 } });
    expect(Number(l.waist)).toBeGreaterThanOrEqual(31); expect(Number(l.waist)).toBeLessThanOrEqual(34);
    expect(likelyFor(l, "Tops")).toBe("L"); expect(likelyFor(l, "Bottoms")).toBe(l.waist); expect(likelyFor(l, "Shoes")).toBeNull();
    // tall bumps up, short bumps down
    await setMeasurement(avery, avery.id, height.id, "75");
    expect((await likelySizes(avery.id))!.letter).toBe("XL");
    await setMeasurement(avery, avery.id, height.id, "63");
    expect((await likelySizes(avery.id))!.letter).toBe("M");
    // minors never get a band
    await setMeasurement(avery, devon.id, height.id, "60"); await setMeasurement(avery, devon.id, weight.id, "100");
    expect(await likelySizes(devon.id)).toBeNull();
    expect(measurementOptions({ name: "Height", unit: "in" })[0]).toBe("48");
    expect(measurementOptions({ name: "Shoe size", unit: "US" })).toContain("M 10.5 / W 12");
    expect(measurementOptions({ name: "Weight", unit: "lb" })).toContain("185");
    expect(measurementOptions({ name: "Tattoo count", unit: "" })).toEqual([]);
    expect(formatMeasurement({ name: "Height", unit: "in" }, "71")).toBe(`5'11"`);
    expect(formatMeasurement({ name: "Waist", unit: "in" }, "32")).toBe("32 in");
  });
});

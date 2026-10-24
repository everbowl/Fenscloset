import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
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
    const [jeff, olivia, mya] = await Promise.all([by("Jeff"), by("Olivia"), by("Mya")]);
    const [lulu, nike] = await db.brand.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, take: 2 });
    const [tops, bottoms, shoes] = await Promise.all([cat("Tops"), cat("Bottoms"), cat("Shoes")]);
    expect(await listMyBrands(jeff.id)).toEqual([]);
    await setMyBrand(jeff, jeff.id, { brandId: lulu.id, url: "shop.lululemon.com", sizes: [{ categoryId: tops.id, size: " L " }, { categoryId: bottoms.id, size: "32" }] });
    await setMyBrand(jeff, jeff.id, { brandId: nike.id, sizes: [{ categoryId: shoes.id, size: "11" }] });
    const mine = await listMyBrands(jeff.id);
    const l = mine.find((b) => b.brandId === lulu.id)!;
    expect(l).toMatchObject({ url: "https://shop.lululemon.com/" });
    expect(l.sizes.map((s) => [s.categoryName, s.size])).toEqual([["Tops", "L"], ["Bottoms", "32"]]);
    expect(sizeFor(l, tops.id)).toBe("L");
    expect(sizeFor(l, bottoms.id)).toBe("32");
    expect(sizeFor(l, shoes.id)).toBeNull(); // two sizes, neither for shoes: no guess
    expect(sizeFor(mine.find((b) => b.brandId === nike.id)!, tops.id)).toBe("11"); // one size only: offered anyway
    // clear one type; the link stays unless cleared on purpose
    await setMyBrand(jeff, jeff.id, { brandId: lulu.id, url: null, sizes: [{ categoryId: bottoms.id, size: "" }] });
    expect((await listMyBrands(jeff.id)).find((b) => b.brandId === lulu.id)).toMatchObject({ url: "https://shop.lululemon.com/", sizes: [{ categoryName: "Tops", size: "L" }] });
    await setMyBrand(jeff, jeff.id, { brandId: lulu.id, url: "" });
    expect((await listMyBrands(jeff.id)).find((b) => b.brandId === lulu.id)).toMatchObject({ url: null });
    await expect(setMyBrand(jeff, jeff.id, { brandId: lulu.id, url: "not a link" })).rejects.toThrow(/link/);
    await removeMyBrand(jeff, jeff.id, lulu.id);
    expect((await listMyBrands(jeff.id)).map((b) => b.brandId)).toEqual([nike.id]);
    expect(await db.bodySizeByBrand.count({ where: { personId: jeff.id, brandId: lulu.id } })).toBe(0);
    // minors: parent yes, sibling no
    await setMyBrand(jeff, mya.id, { brandId: nike.id, sizes: [{ categoryId: tops.id, size: "Youth M" }] });
    expect((await listMyBrands(mya.id))[0].sizes[0]).toMatchObject({ categoryName: "Tops", size: "Youth M" });
    await expect(setMyBrand(olivia, mya.id, { brandId: lulu.id })).rejects.toMatchObject({ status: 403 });
    await expect(removeMyBrand(olivia, mya.id, nike.id)).rejects.toMatchObject({ status: 403 });
  });

  it("a piece confirmed with one of my brands carries the brand link as its store link", async () => {
    const jeff = await by("Jeff");
    const lulu = await db.brand.findFirstOrThrow({ where: { isArchived: false } });
    await setMyBrand(jeff, jeff.id, { brandId: lulu.id, url: "https://shop.lululemon.com/", sizes: [{ categoryId: (await cat("Tops")).id, size: "M" }] });
    const b = await getOrCreateOpenBatch(jeff.id, 1);
    const key = newKey("originals", jeff.id, "image/jpeg");
    await putObject(key, await sharp({ create: { width: 500, height: 700, channels: 3, background: { r: 40, g: 30, b: 30 } } }).jpeg().toBuffer(), "image/jpeg");
    const e = await registerEntry(jeff.id, b.id, key, 0);
    await drainQueue();
    const item = await createItemFromEntry(jeff.id, e.id, { brandId: lulu.id, brandText: lulu.name, sizeText: "M" });
    expect(await db.item.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ brandId: lulu.id, size: "M", purchaseUrl: "https://shop.lululemon.com/", storePhoto: false });
  });

  it("likely sizes come from height and weight bands (adults only) and measurement pickers have preloaded options", async () => {
    const [jeff, mya] = await Promise.all([by("Jeff"), by("Mya")]);
    const kinds = await db.measurementKind.findMany();
    const height = kinds.find((k) => k.name === "Height")!, weight = kinds.find((k) => k.name === "Weight")!;
    expect(await likelySizes(jeff.id)).toBeNull();
    await setMeasurement(jeff, jeff.id, height.id, "72");
    await setMeasurement(jeff, jeff.id, weight.id, "185");
    const l = (await likelySizes(jeff.id))!;
    expect(l).toMatchObject({ letter: "L", dress: "12", from: { heightIn: 72, weightLb: 185 } });
    expect(Number(l.waist)).toBeGreaterThanOrEqual(31); expect(Number(l.waist)).toBeLessThanOrEqual(34);
    expect(likelyFor(l, "Tops")).toBe("L"); expect(likelyFor(l, "Bottoms")).toBe(l.waist); expect(likelyFor(l, "Shoes")).toBeNull();
    // tall bumps up, short bumps down
    await setMeasurement(jeff, jeff.id, height.id, "75");
    expect((await likelySizes(jeff.id))!.letter).toBe("XL");
    await setMeasurement(jeff, jeff.id, height.id, "63");
    expect((await likelySizes(jeff.id))!.letter).toBe("M");
    // minors never get a band
    await setMeasurement(jeff, mya.id, height.id, "60"); await setMeasurement(jeff, mya.id, weight.id, "100");
    expect(await likelySizes(mya.id)).toBeNull();
    expect(measurementOptions({ name: "Height", unit: "in" })[0]).toBe("48");
    expect(measurementOptions({ name: "Shoe size", unit: "US" })).toContain("M 10.5 / W 12");
    expect(measurementOptions({ name: "Weight", unit: "lb" })).toContain("185");
    expect(measurementOptions({ name: "Tattoo count", unit: "" })).toEqual([]);
    expect(formatMeasurement({ name: "Height", unit: "in" }, "71")).toBe(`5'11"`);
    expect(formatMeasurement({ name: "Waist", unit: "in" }, "32")).toBe("32 in");
  });
});

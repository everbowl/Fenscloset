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
import { listMyBrands, removeMyBrand, setMyBrand } from "@/lib/profiles/brands";

describe("my brands & sizes", () => {
  beforeEach(async () => {
    await resetDb(); process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-mybrands-"));
    await seed();
  });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });

  it("lists favorites with size and link; set/update/remove; parent edits a minor, sibling cannot", async () => {
    const [jeff, olivia, mya] = await Promise.all([by("Jeff"), by("Olivia"), by("Mya")]);
    const [lulu, nike] = await db.brand.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, take: 2 });
    expect(await listMyBrands(jeff.id)).toEqual([]);
    await setMyBrand(jeff, jeff.id, { brandId: lulu.id, size: " L ", url: "shop.lululemon.com" });
    await setMyBrand(jeff, jeff.id, { brandId: nike.id });
    const mine = await listMyBrands(jeff.id);
    expect(mine.map((b) => b.brandId).sort()).toEqual([lulu.id, nike.id].sort());
    expect(mine.find((b) => b.brandId === lulu.id)).toMatchObject({ size: "L", url: "https://shop.lululemon.com/" });
    expect(mine.find((b) => b.brandId === nike.id)).toMatchObject({ size: null });
    // size clears with an empty string; the link is shared by the brand, so it stays unless cleared on purpose
    await setMyBrand(jeff, jeff.id, { brandId: lulu.id, size: "", url: null });
    expect((await listMyBrands(jeff.id)).find((b) => b.brandId === lulu.id)).toMatchObject({ size: null, url: "https://shop.lululemon.com/" });
    await setMyBrand(jeff, jeff.id, { brandId: lulu.id, url: "" });
    expect((await listMyBrands(jeff.id)).find((b) => b.brandId === lulu.id)).toMatchObject({ url: null });
    await expect(setMyBrand(jeff, jeff.id, { brandId: lulu.id, url: "not a link" })).rejects.toThrow(/link/);
    await removeMyBrand(jeff, jeff.id, lulu.id);
    expect((await listMyBrands(jeff.id)).map((b) => b.brandId)).toEqual([nike.id]);
    expect(await db.bodySizeByBrand.count({ where: { personId: jeff.id } })).toBe(0);
    // minors: parent yes, sibling no
    await setMyBrand(jeff, mya.id, { brandId: nike.id, size: "XS" });
    expect((await listMyBrands(mya.id))[0]).toMatchObject({ brandId: nike.id, size: "XS" });
    await expect(setMyBrand(olivia, mya.id, { brandId: lulu.id })).rejects.toMatchObject({ status: 403 });
    await expect(removeMyBrand(olivia, mya.id, nike.id)).rejects.toMatchObject({ status: 403 });
  });

  it("a piece confirmed with one of my brands carries the brand link as its store link", async () => {
    const jeff = await by("Jeff");
    const lulu = await db.brand.findFirstOrThrow({ where: { isArchived: false } });
    await setMyBrand(jeff, jeff.id, { brandId: lulu.id, size: "M", url: "https://shop.lululemon.com/" });
    const b = await getOrCreateOpenBatch(jeff.id, 1);
    const key = newKey("originals", jeff.id, "image/jpeg");
    await putObject(key, await sharp({ create: { width: 500, height: 700, channels: 3, background: { r: 40, g: 30, b: 30 } } }).jpeg().toBuffer(), "image/jpeg");
    const e = await registerEntry(jeff.id, b.id, key, 0);
    await drainQueue();
    const item = await createItemFromEntry(jeff.id, e.id, { brandId: lulu.id, brandText: lulu.name, sizeText: "M" });
    expect(await db.item.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ brandId: lulu.id, size: "M", purchaseUrl: "https://shop.lululemon.com/", storePhoto: false });
  });
});

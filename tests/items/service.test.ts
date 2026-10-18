import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { newKey, putObject } from "@/lib/storage";
import { getOrCreateOpenBatch, openBatch, registerEntry } from "@/lib/import/service";
import { drainQueue } from "@/lib/import/queue";
import { createItemFromEntry, mergeIntoItem, saveEntryEdits, skipEntry } from "@/lib/items/service";
import { findLikelyDuplicate } from "@/lib/items/duplicates";
import { loadTagLists } from "@/lib/ai/tag-item";
import type { EntryAiResult } from "@/lib/import/process";

async function photo(seedColor: number) {
  return sharp({ create: { width: 500, height: 700, channels: 3, background: { r: seedColor, g: 30, b: 30 } } })
    .composite([{ input: await sharp({ create: { width: 500, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer(), top: seedColor % 300, left: 0 }])
    .jpeg().toBuffer();
}

describe("confirm → item", () => {
  let jeffId: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true";
    delete process.env.MOCK_REMOVE_BG_FAIL;
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-items-"));
    await seed();
    jeffId = (await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } })).id;
  });

  async function readyEntry(color = 40, order = 0) {
    const b = await getOrCreateOpenBatch(jeffId, 1);
    const key = newKey("originals", jeffId, "image/jpeg");
    await putObject(key, await photo(color), "image/jpeg");
    const e = await registerEntry(jeffId, b.id, key, order);
    await drainQueue();
    return db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
  }

  it("creates the item with photos, M:N tags and the personal closet, then closes the batch", async () => {
    const e = await readyEntry();
    const lists = await loadTagLists();
    const red = lists.colors.find((c) => c.name === "Red")!;
    const item = await createItemFromEntry(jeffId, e.id, { name: "Red crew tee", colorIds: [red.id], sizeText: " L " });
    const full = await db.item.findUniqueOrThrow({ where: { id: item.id }, include: { colors: true, seasons: true, photos: true, closets: { include: { closet: true } }, category: true } });
    expect(full.name).toBe("Red crew tee");
    expect(full.size).toBe("L");
    expect(full.category!.name).toBe("Tops");
    expect(full.colors.map((c) => c.name)).toEqual(["Red"]);
    expect(full.seasons.length).toBe(2);
    expect(full.photos.map((p) => p.kind).sort()).toEqual(["alone", "cutout", "thumb"]);
    expect(full.photos.find((p) => p.isPrimary)!.kind).toBe("cutout");
    expect(full.closets[0].closet.kind).toBe("personal");
    expect(full.phash).toBe(e.phash);
    expect((await db.importEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("done");
    expect(await openBatch(jeffId)).toBeNull();
    await expect(createItemFromEntry(jeffId, e.id)).rejects.toMatchObject({ status: 409 });
  });

  it("keeps the entry in needs_confirm when the category is missing, and saves row edits for later", async () => {
    const e = await readyEntry();
    await expect(createItemFromEntry(jeffId, e.id, { categoryId: null })).rejects.toThrow(/Pick a category/);
    expect((await db.importEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("needs_confirm");
    const tags = await saveEntryEdits(jeffId, e.id, { name: "Renamed", seasonIds: [] });
    expect(tags.name).toBe("Renamed");
    expect(((await db.importEntry.findUniqueOrThrow({ where: { id: e.id } })).aiResult as EntryAiResult).tags.name).toBe("Renamed");
    await skipEntry(jeffId, e.id);
    expect(await openBatch(jeffId)).toBeNull();
  });

  it("flags the same photo as a likely duplicate, not a different one, and SAME? merges photos", async () => {
    const first = await readyEntry(40, 0);
    const item = await createItemFromEntry(jeffId, first.id);
    const again = await readyEntry(40, 1); // same picture again
    const other = await readyEntry(250, 2); // clearly different
    const lists = await loadTagLists();
    const probeA = (again.aiResult as EntryAiResult).tags;
    const dup = await findLikelyDuplicate(jeffId, { phash: again.phash, categoryId: probeA.categoryId, colorIds: probeA.colorIds, brandId: null });
    expect(dup?.itemId).toBe(item.id);
    expect(dup?.reason).toBe("photo");
    const none = await findLikelyDuplicate(jeffId, { phash: other.phash, categoryId: probeA.categoryId, colorIds: probeA.colorIds, brandId: null });
    expect(none).toBeNull();
    // tag rule needs a brand: same category + colour alone is not enough
    const nike = lists.brands.find((b) => b.name === "Nike")!;
    expect(await findLikelyDuplicate(jeffId, { phash: null, categoryId: probeA.categoryId, colorIds: probeA.colorIds, brandId: nike.id })).toBeNull();
    await db.item.update({ where: { id: item.id }, data: { brandId: nike.id } });
    expect((await findLikelyDuplicate(jeffId, { phash: null, categoryId: probeA.categoryId, colorIds: probeA.colorIds, brandId: nike.id }))?.reason).toBe("tags");
    await mergeIntoItem(jeffId, again.id, item.id);
    const merged = await db.item.findUniqueOrThrow({ where: { id: item.id }, include: { photos: true } });
    expect(merged.photos.length).toBe(6);
    expect(merged.photos.filter((p) => p.isPrimary).length).toBe(1);
    expect(await db.item.count()).toBe(1);
  });
});

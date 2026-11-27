import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { newKey, objectExists, putObject } from "@/lib/storage";
import { applyStoreMeta, processEntry, type EntryAiResult } from "@/lib/import/process";
import { getObject } from "@/lib/storage";
import { rotateEntry } from "@/lib/import/rotate-entry";
import { createItemFromEntry, emptyTags } from "@/lib/items/service";
import { loadTagLists } from "@/lib/ai/tag-item";
import { _backdateInFlight, drainQueue, enqueueProcessing, reapStuck, STUCK_MESSAGE } from "@/lib/import/queue";

async function photo() {
  return sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 30, g: 30, b: 30 } } }).jpeg().toBuffer();
}

describe("import processing", () => {
  let averyId: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true";
    delete process.env.MOCK_REMOVE_BG_FAIL; delete process.env.MOCK_ORIENTATION;
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-import-"));
    await seed();
    averyId = (await db.person.findUniqueOrThrow({ where: { email: "avery@example.test" } })).id;
  });

  async function entryWithPhoto(upload = true) {
    const batch = await db.importBatch.create({ data: { personId: averyId } });
    const originalKey = newKey("originals", averyId, "image/jpeg");
    if (upload) await putObject(originalKey, await photo(), "image/jpeg");
    return db.importEntry.create({ data: { batchId: batch.id, order: 0, originalKey, status: upload ? "uploaded" : "queued" } });
  }

  it("runs the chain and lands in needs_confirm with cutout, thumb, hash and tags", async () => {
    const e = await entryWithPhoto();
    expect(await processEntry(e.id)).toEqual({ status: "needs_confirm" });
    const done = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(done.status).toBe("needs_confirm");
    expect(done.cutoutKey).toMatch(/^cutouts\//);
    expect(done.thumbKey).toMatch(/^thumbs\//);
    expect(await objectExists(done.cutoutKey!)).toBe(true);
    expect(await objectExists(done.thumbKey!)).toBe(true);
    expect(done.phash).toHaveLength(16);
    const ai = done.aiResult as EntryAiResult;
    expect(ai.tags.categoryId).toBeTruthy();
    expect(ai.warnings).toEqual([]);
    // already confirmed-ready entries are not reprocessed
    expect(await processEntry(e.id)).toEqual({ status: "needs_confirm" });
  });

  it("auto-uprights a sideways photo when the tagger says which turn fixes it", async () => {
    process.env.MOCK_ORIENTATION = "rotate_right";
    const e = await entryWithPhoto();
    expect((await processEntry(e.id)).status).toBe("needs_confirm");
    const done = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    const meta = await sharp((await getObject(done.cutoutKey!)).body).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 900]); // 900×1200 turned on its side
    expect((done.aiResult as EntryAiResult).warnings).toEqual(["auto_rotated:90"]);
    const thumb = await sharp((await getObject(done.thumbKey!)).body).metadata();
    expect(thumb.width!).toBeGreaterThan(thumb.height!);
  });

  it("ROTATE on the card turns the photo a quarter turn each time, remakes the thumb and hash, drops the old files", async () => {
    const e = await entryWithPhoto();
    await processEntry(e.id);
    const before = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    const r = await rotateEntry(averyId, e.id, "right");
    expect(r.photoKey).not.toBe(before.cutoutKey);
    const after = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.cutoutKey).toBe(r.photoKey);
    const meta = await sharp((await getObject(after.cutoutKey!)).body).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 900]);
    expect(await objectExists(before.cutoutKey!)).toBe(false);
    expect(await objectExists(before.thumbKey!)).toBe(false);
    expect(await objectExists(after.thumbKey!)).toBe(true);
    await rotateEntry(averyId, e.id, "right");
    const twice = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    const m2 = await sharp((await getObject(twice.cutoutKey!)).body).metadata();
    expect([m2.width, m2.height]).toEqual([900, 1200]);
    // someone else's entry: refused
    const other = await db.person.create({ data: { name: "Other", email: "other@example.com", role: "member" } });
    await expect(rotateEntry(other.id, e.id, "right")).rejects.toMatchObject({ status: 403 });
  });

  it("decides 'looks like one you own' while processing: the same picture again is confirmed, a different piece of the same kind is not", async () => {
    const first = await entryWithPhoto();
    await processEntry(first.id);
    const item = await createItemFromEntry(averyId, first.id);
    const again = await entryWithPhoto(); // identical picture
    await processEntry(again.id);
    const dup = (await db.importEntry.findUniqueOrThrow({ where: { id: again.id } })).aiResult as EntryAiResult;
    expect(dup.duplicate?.itemId).toBe(item.id);
    expect(dup.duplicate?.reason).toBe("photo");
    // another dark top of the same kind: the hash is close, Claude (mock: not byte-identical) says no
    const batch = await db.importBatch.create({ data: { personId: averyId } });
    const key = newKey("originals", averyId, "image/jpeg");
    await putObject(key, await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 34, g: 30, b: 32 } } }).jpeg().toBuffer(), "image/jpeg");
    const other = await db.importEntry.create({ data: { batchId: batch.id, order: 1, originalKey: key, status: "uploaded" } });
    await processEntry(other.id);
    const none = (await db.importEntry.findUniqueOrThrow({ where: { id: other.id } })).aiResult as EntryAiResult;
    expect(none.duplicate).toBeNull();
  });

  it("keeps the original usable when remove.bg fails, and says why", async () => {
    process.env.MOCK_REMOVE_BG_FAIL = "insufficient_credits";
    const e = await entryWithPhoto();
    expect((await processEntry(e.id)).status).toBe("needs_confirm");
    const done = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(done.cutoutKey).toBeNull();
    expect(done.thumbKey).toBeTruthy();
    expect((done.aiResult as EntryAiResult).warnings).toEqual(["bg_failed:insufficient_credits"]);
  });

  it("marks a missing upload failed with a plain message, and recovers on retry", async () => {
    const e = await entryWithPhoto(false);
    const first = await processEntry(e.id);
    expect(first.status).toBe("failed");
    expect(first.error).toMatch(/never finished uploading/);
    expect((await db.importEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("failed");
    await putObject(e.originalKey, await photo(), "image/jpeg");
    expect((await processEntry(e.id)).status).toBe("needs_confirm");
  });

  it("a retry drops the previous run's cutout and thumb (review B B4)", async () => {
    const e = await entryWithPhoto();
    await processEntry(e.id);
    const first = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    await db.importEntry.update({ where: { id: e.id }, data: { status: "failed" } });
    expect((await processEntry(e.id)).status).toBe("needs_confirm");
    const second = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(second.cutoutKey).not.toBe(first.cutoutKey);
    expect(await objectExists(first.cutoutKey!)).toBe(false);
    expect(await objectExists(first.thumbKey!)).toBe(false);
    expect(await objectExists(second.cutoutKey!)).toBe(true);
    expect(await objectExists(second.thumbKey!)).toBe(true);
  });

  it("a late answer never overwrites a row someone else took over (review B A2.4, B5, B11): the watchdog's failure stands and the late files are dropped", async () => {
    const e = await entryWithPhoto();
    const run = processEntry(e.id);
    // wait for the claim, then take the row away as the watchdog would
    for (let i = 0; i < 100; i++) { if ((await db.importEntry.findUniqueOrThrow({ where: { id: e.id } })).status === "processing") break; await new Promise((r) => setTimeout(r, 10)); }
    await db.importEntry.updateMany({ where: { id: e.id, status: "processing" }, data: { status: "failed", error: STUCK_MESSAGE } });
    expect((await run).status).toBe("failed");
    const after = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.status).toBe("failed");
    expect(after.error).toBe(STUCK_MESSAGE);
    expect(after.cutoutKey).toBeNull(); // nothing of the dropped run landed on the row
    // the thumbs folder holds nothing for this owner: the late run cleaned up after itself
    const { readdir } = await import("node:fs/promises");
    const thumbs = await readdir(path.join(process.env.MOCK_S3_DIR!, "thumbs", averyId)).catch(() => [] as string[]);
    expect(thumbs).toEqual([]);
    // and a retry works as usual
    expect((await processEntry(e.id)).status).toBe("needs_confirm");
  });

  it("the watchdog drops an entry that has been in flight too long and marks it failed with a plain reason; Try again then works (review B A2.4)", async () => {
    const e = await entryWithPhoto();
    enqueueProcessing(e.id);
    // the worker claims the row, then (as far as the watchdog can tell) hangs
    for (let i = 0; i < 100; i++) { if ((await db.importEntry.findUniqueOrThrow({ where: { id: e.id } })).status === "processing") break; await new Promise((r) => setTimeout(r, 10)); }
    _backdateInFlight(e.id, 10 * 60_000);
    const dropped = await reapStuck(3 * 60_000);
    expect(dropped).toContain(e.id);
    await drainQueue();
    const after = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.status).toBe("failed");
    expect(after.error).toBe(STUCK_MESSAGE);
    expect(await reapStuck()).toEqual([]); // nothing left in flight
    // the dropped run finishes on its own in the background and changes nothing; Try again then works
    await new Promise((r) => setTimeout(r, 1500));
    expect((await db.importEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("failed");
    expect((await processEntry(e.id)).status).toBe("needs_confirm");
  });

  it("a store piece whose category the tagger could not place still lands in the closet, with no category (review B A2.2)", async () => {
    // no categories to pick from: the mock tagger answers "unknown"
    await db.category.updateMany({ data: { isArchived: true } });
    const batch = await db.importBatch.create({ data: { personId: averyId } });
    const originalKey = newKey("originals", averyId, "image/jpeg");
    await putObject(originalKey, await photo(), "image/jpeg");
    const meta = { name: "Woven belt", brandText: null, storeName: "Mock Store", priceText: "$40", url: "https://mock.example/products/belt", imageUrl: null, color: "Black", size: null, purchaseDate: null };
    const e = await db.importEntry.create({ data: { batchId: batch.id, order: 0, originalKey, status: "uploaded", storeMeta: meta } });
    expect(await processEntry(e.id)).toEqual({ status: "done" });
    const done = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(done.status).toBe("done");
    const item = await db.item.findUniqueOrThrow({ where: { id: done.itemId! } });
    expect(item.categoryId).toBeNull();
    expect(item.name).toBe("Woven belt");
    expect(item.storePhoto).toBe(true);
  });

  it("the store's own category wins over the guess when it names one of the family's categories; an unknown one changes nothing", async () => {
    const lists = await loadTagLists();
    const tops = lists.categories.find((c) => c.name === "Tops")!;
    const bottoms = lists.categories.find((c) => c.name === "Bottoms")!;
    const guess = { ...emptyTags(), categoryId: tops.id, subcategoryId: tops.subcategories[0]?.id ?? null };
    const base = { name: "Straight jeans", brandText: null, storeName: "S", priceText: null, url: null, imageUrl: null, color: null, size: null, purchaseDate: null };
    const won = applyStoreMeta(guess, { ...base, category: "bottoms" }, lists);
    expect(won.categoryId).toBe(bottoms.id);
    expect(won.subcategoryId).toBeNull(); // the guess's subcategory belonged to Tops
    const kept = applyStoreMeta(guess, { ...base, category: "Gadgets" }, lists);
    expect(kept.categoryId).toBe(tops.id);
    expect(kept.subcategoryId).toBe(guess.subcategoryId);
  });

  it("an auto-add that fails keeps the card and records why on the entry (review B B6)", async () => {
    const batch = await db.importBatch.create({ data: { personId: averyId } });
    const originalKey = newKey("originals", averyId, "image/jpeg");
    await putObject(originalKey, await photo(), "image/jpeg");
    // a purchase date no calendar has (a receipt read gone wrong) makes the item insert fail
    const meta = { name: "Tee", brandText: null, storeName: "Mock Store", priceText: null, url: null, imageUrl: null, color: null, size: null, purchaseDate: "2026-13-45" };
    const e = await db.importEntry.create({ data: { batchId: batch.id, order: 0, originalKey, status: "uploaded", storeMeta: meta } });
    const r = await processEntry(e.id);
    expect(r.status).toBe("needs_confirm");
    expect(r.error).toMatch(/Could not add it on its own/);
    const after = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.status).toBe("needs_confirm");
    expect(after.error).toMatch(/Could not add it on its own/);
    expect(after.itemId).toBeNull();
  });
});

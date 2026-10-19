import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { newKey, objectExists, putObject } from "@/lib/storage";
import { processEntry, type EntryAiResult } from "@/lib/import/process";
import { getObject } from "@/lib/storage";
import { rotateEntry } from "@/lib/import/rotate-entry";
import { createItemFromEntry } from "@/lib/items/service";
import { keepSmooth } from "@/lib/import/smooth-entry";

async function photo() {
  return sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 30, g: 30, b: 30 } } }).jpeg().toBuffer();
}

describe("import processing", () => {
  let jeffId: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true";
    delete process.env.MOCK_REMOVE_BG_FAIL; delete process.env.MOCK_ORIENTATION; process.env.AUTO_TIDY = "false";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-import-"));
    await seed();
    jeffId = (await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } })).id;
  });

  async function entryWithPhoto(upload = true) {
    const batch = await db.importBatch.create({ data: { personId: jeffId } });
    const originalKey = newKey("originals", jeffId, "image/jpeg");
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
    const r = await rotateEntry(jeffId, e.id, "right");
    expect(r.photoKey).not.toBe(before.cutoutKey);
    const after = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.cutoutKey).toBe(r.photoKey);
    const meta = await sharp((await getObject(after.cutoutKey!)).body).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 900]);
    expect(await objectExists(before.cutoutKey!)).toBe(false);
    expect(await objectExists(before.thumbKey!)).toBe(false);
    expect(await objectExists(after.thumbKey!)).toBe(true);
    await rotateEntry(jeffId, e.id, "right");
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
    const item = await createItemFromEntry(jeffId, first.id);
    const again = await entryWithPhoto(); // identical picture
    await processEntry(again.id);
    const dup = (await db.importEntry.findUniqueOrThrow({ where: { id: again.id } })).aiResult as EntryAiResult;
    expect(dup.duplicate?.itemId).toBe(item.id);
    expect(dup.duplicate?.reason).toBe("photo");
    // another dark top of the same kind: the hash is close, Claude (mock: not byte-identical) says no
    const batch = await db.importBatch.create({ data: { personId: jeffId } });
    const key = newKey("originals", jeffId, "image/jpeg");
    await putObject(key, await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 34, g: 30, b: 32 } } }).jpeg().toBuffer(), "image/jpeg");
    const other = await db.importEntry.create({ data: { batchId: batch.id, order: 1, originalKey: key, status: "uploaded" } });
    await processEntry(other.id);
    const none = (await db.importEntry.findUniqueOrThrow({ where: { id: other.id } })).aiResult as EntryAiResult;
    expect(none.duplicate).toBeNull();
  });

  it("auto-tidy parks a clean product picture on the card; the confirm keeps it as the cutout unless it was undone", async () => {
    delete process.env.AUTO_TIDY; process.env.MOCK_SMOOTH = "true";
    const e = await entryWithPhoto();
    await processEntry(e.id);
    const done = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(done.smoothKey).toMatch(/^cutouts\/.*\.png$/);
    expect((done.aiResult as EntryAiResult).warnings).toEqual(["auto_tidied"]);
    expect(await objectExists(done.smoothKey!)).toBe(true);
    const kept = await keepSmooth(jeffId, e.id, true);
    expect(kept.photoKey).toBe(done.smoothKey);
    const item = await createItemFromEntry(jeffId, e.id);
    const photos = await db.itemPhoto.findMany({ where: { itemId: item.id } });
    expect(photos.find((p) => p.kind === "cutout")?.bucketKey).toBe(done.smoothKey);
    // turned off: nothing parked
    process.env.AUTO_TIDY = "false";
    const plain = await entryWithPhoto();
    await processEntry(plain.id);
    expect((await db.importEntry.findUniqueOrThrow({ where: { id: plain.id } })).smoothKey).toBeNull();
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
});

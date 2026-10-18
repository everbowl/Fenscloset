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
import { attachEntryPhoto, createItemFromEntry, saveEntryEdits } from "@/lib/items/service";
import { readBackForEntry, type EntryAiResult } from "@/lib/import/process";
import { keepSmooth, smoothEntry } from "@/lib/import/smooth-entry";
import { isSmoothConfigured, smoothGarment } from "@/lib/images/smooth";

async function photo() {
  return sharp({ create: { width: 500, height: 700, channels: 3, background: { r: 40, g: 30, b: 30 } } })
    .composite([{ input: await sharp({ create: { width: 500, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer(), top: 100, left: 0 }])
    .jpeg().toBuffer();
}

describe("smooth wrinkles + back photo", () => {
  let jeffId: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true"; process.env.MOCK_SMOOTH = "true";
    delete process.env.MOCK_REMOVE_BG_FAIL;
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-smooth-"));
    await seed();
    jeffId = (await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } })).id;
  });

  async function readyEntry() {
    const b = await getOrCreateOpenBatch(jeffId, 1);
    const key = newKey("originals", jeffId, "image/jpeg");
    await putObject(key, await photo(), "image/jpeg");
    const e = await registerEntry(jeffId, b.id, key, 0);
    await drainQueue();
    return db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
  }

  it("keeps the cutout silhouette: a transparent PNG comes back as a PNG with the same alpha", async () => {
    expect(isSmoothConfigured()).toBe(true);
    const cutout = await sharp({ create: { width: 200, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 120, g: 90, b: 60, alpha: 1 } } }).png().toBuffer(), top: 100, left: 0 }])
      .png().toBuffer();
    const out = await smoothGarment(cutout);
    expect(out.contentType).toBe("image/png");
    const meta = await sharp(out.data).metadata();
    expect([meta.width, meta.height]).toEqual([200, 300]);
    const alpha = await sharp(out.data).extractChannel("alpha").raw().toBuffer();
    expect(alpha[0]).toBe(0); // top strip still transparent
    expect(alpha[alpha.length - 1]).toBe(255);
    const plain = await smoothGarment(await photo());
    expect(plain.contentType).toBe("image/jpeg");
  });

  it("SMOOTH parks a copy; UNDO throws it away; KEEP makes it the cutout with a fresh thumbnail", async () => {
    const e = await readyEntry();
    const { smoothKey } = await smoothEntry(jeffId, e.id);
    expect(smoothKey).toMatch(/^cutouts\//);
    expect(await objectExists(smoothKey)).toBe(true);
    expect((await smoothEntry(jeffId, e.id)).smoothKey).toBe(smoothKey); // no second call while parked
    expect((await keepSmooth(jeffId, e.id, false)).photoKey).toBe(e.cutoutKey);
    expect(await objectExists(smoothKey)).toBe(false);
    expect((await db.importEntry.findUniqueOrThrow({ where: { id: e.id } })).smoothKey).toBeNull();

    const again = await smoothEntry(jeffId, e.id);
    expect((await keepSmooth(jeffId, e.id, true)).photoKey).toBe(again.smoothKey);
    const kept = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(kept.cutoutKey).toBe(again.smoothKey);
    expect(kept.smoothKey).toBeNull();
    expect(kept.thumbKey).not.toBe(e.thumbKey);
    expect(await objectExists(kept.thumbKey!)).toBe(true);
    expect(await objectExists(e.cutoutKey!)).toBe(false);
    const item = await createItemFromEntry(jeffId, e.id);
    const photos = await db.itemPhoto.findMany({ where: { itemId: item.id } });
    expect(photos.find((p) => p.kind === "cutout")?.bucketKey).toBe(again.smoothKey);
  });

  it("only the owner can smooth", async () => {
    const e = await readyEntry();
    const mya = await db.person.findFirstOrThrow({ where: { name: "Mya" } });
    await expect(smoothEntry(mya.id, e.id)).rejects.toThrow(/Not yours/);
  });

  it("a back photo is re-read with the front, keeps what the person edited, and lands on the item", async () => {
    const e = await readyEntry();
    await saveEntryEdits(jeffId, e.id, { name: "Make Moves tee", colorIds: [] });
    const backKey = newKey("originals", jeffId, "image/jpeg");
    await putObject(backKey, await photo(), "image/jpeg");
    await attachEntryPhoto(jeffId, e.id, "back", backKey);
    const res = await readBackForEntry(e.id, backKey);
    expect(res?.tags.name).toBe("Make Moves tee"); // edited: kept
    expect(res?.tags.colorIds).toEqual([]); // edited: kept
    expect(res?.tags.categoryId).toBeTruthy(); // not edited: from the two-photo read
    const saved = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(saved.backKey).toBe(backKey);
    expect((saved.aiResult as EntryAiResult).edited).toEqual(["name", "colorIds"]);
    const item = await createItemFromEntry(jeffId, e.id);
    const photos = await db.itemPhoto.findMany({ where: { itemId: item.id } });
    expect(photos.find((p) => p.kind === "back")?.bucketKey).toBe(backKey);
    expect(photos.find((p) => p.kind === "back")?.isPrimary).toBe(false);
  });
});

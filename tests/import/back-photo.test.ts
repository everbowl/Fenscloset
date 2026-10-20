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
import { attachEntryPhoto, createItemFromEntry, saveEntryEdits } from "@/lib/items/service";
import { readBackForEntry, type EntryAiResult } from "@/lib/import/process";
import { fitCutout } from "@/lib/images/thumb";

async function photo() {
  return sharp({ create: { width: 500, height: 700, channels: 3, background: { r: 40, g: 30, b: 30 } } })
    .composite([{ input: await sharp({ create: { width: 500, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer(), top: 100, left: 0 }])
    .jpeg().toBuffer();
}

describe("cutout fit + back photo", () => {
  let jeffId: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true";
    delete process.env.MOCK_REMOVE_BG_FAIL;
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-back-"));
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

  it("a cutout is trimmed to the piece with a slim margin, so it fills the box", async () => {
    const roomy = await sharp({ create: { width: 400, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 200, height: 300, channels: 4, background: { r: 120, g: 90, b: 60, alpha: 1 } } }).png().toBuffer(), top: 150, left: 100 }])
      .png().toBuffer();
    const meta = await sharp(await fitCutout(roomy)).metadata();
    expect(meta.width).toBe(200 + 2 * 12);
    expect(meta.height).toBe(300 + 2 * 12);
    const opaque = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    expect(await fitCutout(opaque)).toEqual(opaque); // nothing transparent to trim: untouched (the mock cutter returns opaque PNGs)
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

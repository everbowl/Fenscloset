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

async function photo() {
  return sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 30, g: 30, b: 30 } } }).jpeg().toBuffer();
}

describe("import processing", () => {
  let jeffId: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true";
    delete process.env.MOCK_REMOVE_BG_FAIL;
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

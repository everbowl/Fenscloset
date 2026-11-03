import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { drainQueue, enqueueProcessing } from "@/lib/import/queue";
import { getOrCreateOpenBatch } from "@/lib/import/service";
import { getObject, newKey, objectExists, putObject } from "@/lib/storage";
import { findPieces, splitEntry } from "@/lib/import/split";

/** Three shirts side by side: black, black, white strips. */
async function threeShirts(): Promise<Buffer> {
  const strip = (r: number, g: number, b: number) => sharp({ create: { width: 300, height: 600, channels: 3, background: { r, g, b } } }).png().toBuffer();
  return sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 240, g: 240, b: 240 } } })
    .composite([{ input: await strip(20, 20, 20), left: 0, top: 0 }, { input: await strip(20, 20, 20), left: 300, top: 0 }, { input: await strip(250, 250, 250), left: 600, top: 0 }])
    .jpeg().toBuffer();
}

describe("several shirts in one photo (Jeff, 2–3 Nov 2026, E1)", () => {
  let jeffId: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true"; process.env.MOCK_FETCH = "true"; process.env.MOCK_SERPER = "true";
    delete process.env.MOCK_REMOVE_BG_FAIL;
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-split-"));
    await seed();
    jeffId = (await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } })).id;
  });

  async function photoEntry() {
    const batch = await getOrCreateOpenBatch(jeffId, 1);
    const key = newKey("originals", jeffId, "image/jpeg");
    await putObject(key, await threeShirts(), "image/jpeg");
    const entry = await db.importEntry.create({ data: { batchId: batch.id, order: batch.startOrder, originalKey: key, status: "uploaded" } });
    enqueueProcessing(entry.id);
    await drainQueue();
    return db.importEntry.findUniqueOrThrow({ where: { id: entry.id } });
  }

  it("the tagger counts the garments in a photo; the mock reads the count from the environment", async () => {
    process.env.MOCK_PIECE_COUNT = "3";
    const entry = await photoEntry();
    expect(entry.status).toBe("needs_confirm");
    expect((entry.aiResult as { tags: { pieceCount?: number } }).tags.pieceCount).toBe(3);
    delete process.env.MOCK_PIECE_COUNT;
    const boxes = await findPieces({ data: "", mediaType: "image/jpeg" });
    expect(boxes).toHaveLength(2); // the mock's default
  });

  it("splits the photo into one crop per garment, the same color twice as one entry with two copies; the original steps aside", async () => {
    process.env.MOCK_PIECE_COUNT = "3"; process.env.MOCK_PIECE_COLORS = "Black,Black,White";
    const entry = await photoEntry();
    const r = await splitEntry(jeffId, entry.id);
    expect(r.pieces).toBe(3);
    expect(r.entryIds).toHaveLength(2);
    const made = await db.importEntry.findMany({ where: { id: { in: r.entryIds } }, orderBy: { order: "asc" } });
    expect(made.map((e) => e.quantity)).toEqual([2, 1]);
    expect(made.every((e) => e.batchId === entry.batchId && e.status === "uploaded")).toBe(true);
    for (const e of made) expect(await objectExists(e.originalKey)).toBe(true);
    // the first crop is the left third of the photo (plus a small margin)
    const crop = await sharp((await getObject(made[0].originalKey)).body).metadata();
    expect(crop.width).toBeGreaterThan(280);
    expect(crop.width).toBeLessThan(360);
    expect(crop.height).toBe(600);
    const original = await db.importEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(original.status).toBe("skipped");
    expect((original.aiResult as { splitInto: string[] }).splitInto).toEqual(r.entryIds);
    expect((await db.importBatch.findUniqueOrThrow({ where: { id: entry.batchId } })).total).toBe(3);
    // the new pieces get tagged like any photo and wait on their own cards (no store facts: no auto-add)
    await drainQueue();
    const tagged = await db.importEntry.findMany({ where: { id: { in: r.entryIds } } });
    expect(tagged.every((e) => e.status === "needs_confirm")).toBe(true);
    await expect(splitEntry(jeffId, entry.id)).rejects.toThrow(/still being tagged|already/);
    delete process.env.MOCK_PIECE_COUNT; delete process.env.MOCK_PIECE_COLORS;
  });

  it("one garment is not split", async () => {
    process.env.MOCK_PIECE_COUNT = "1";
    const entry = await photoEntry();
    await expect(splitEntry(jeffId, entry.id)).rejects.toThrow(/Only one piece/);
    delete process.env.MOCK_PIECE_COUNT;
  });
});

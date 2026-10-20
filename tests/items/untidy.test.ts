import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { deleteObject, getObject, newKey, objectExists, putObject } from "@/lib/storage";
import { getOrCreateOpenBatch, registerEntry } from "@/lib/import/service";
import { drainQueue } from "@/lib/import/queue";
import { createItemFromEntry } from "@/lib/items/service";
import { rotateImage } from "@/lib/images/rotate";
import { bestTurn, untidyAll, UNTIDY_SET } from "@/lib/items/untidy";
import type { EntryAiResult } from "@/lib/import/process";

/** A dark photo with a white band near the top: turned, it looks different, so the orientation check has something to see. */
async function photo() {
  return sharp({ create: { width: 600, height: 900, channels: 3, background: { r: 40, g: 30, b: 30 } } })
    .composite([{ input: await sharp({ create: { width: 600, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer(), top: 60, left: 0 }])
    .jpeg().toBuffer();
}

const dims = async (key: string) => { const m = await sharp((await getObject(key)).body).metadata(); return [m.width, m.height]; };
const warningsOf = async (id: string) => ((await db.importEntry.findUniqueOrThrow({ where: { id } })).aiResult as EntryAiResult).warnings;

describe("untidy: Tidy and Smooth undone on the pieces they touched", () => {
  let jeffId: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true";
    delete process.env.MOCK_REMOVE_BG_FAIL; delete process.env.MOCK_ORIENTATION;
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-untidy-"));
    await seed();
    jeffId = (await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } })).id;
  });

  /** A piece added the normal way (the mock cutter's cutout is the photo itself). */
  async function piece() {
    const b = await getOrCreateOpenBatch(jeffId, 1);
    const key = newKey("originals", jeffId, "image/jpeg");
    await putObject(key, await photo(), "image/jpeg");
    const e = await registerEntry(jeffId, b.id, key, 0);
    await drainQueue();
    const item = await createItemFromEntry(jeffId, e.id);
    const entry = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    const cutout = await db.itemPhoto.findFirstOrThrow({ where: { itemId: item.id, kind: "cutout" } });
    const thumb = await db.itemPhoto.findFirstOrThrow({ where: { itemId: item.id, kind: "thumb" } });
    return { item, entry, cutout, thumb };
  }

  /** What Tidy left behind: another picture under the piece's cutout key (here the photo a quarter turn over, as if the person had turned it on the card). */
  async function tidied(cutoutKey: string, deg: 90 | 180 | 270) {
    await putObject(cutoutKey, await rotateImage((await getObject(cutoutKey)).body, deg, "image/png"), "image/png");
  }

  it("re-cuts every piece added since Smooth went live from its original, keeps the turn, and records the set once", async () => {
    const a = await piece();
    await tidied(a.cutout.bucketKey, 90);
    const b = await piece();
    const lines: string[] = [];
    expect(await untidyAll({ log: (l) => lines.push(l) })).toEqual({ recut: 2, skipped: 0, failed: 0, done: true });
    const aCut = await db.itemPhoto.findUniqueOrThrow({ where: { id: a.cutout.id } });
    expect(aCut.bucketKey).not.toBe(a.cutout.bucketKey);
    expect(await objectExists(a.cutout.bucketKey)).toBe(false);
    expect(await objectExists(aCut.bucketKey)).toBe(true);
    expect(await dims(aCut.bucketKey)).toEqual([900, 600]); // the fresh cutout comes back turned like the old one
    expect([aCut.width, aCut.height, aCut.wholeGarment]).toEqual([900, 600, null]);
    const aThumb = await db.itemPhoto.findUniqueOrThrow({ where: { id: a.thumb.id } });
    expect(aThumb.bucketKey).not.toBe(a.thumb.bucketKey);
    expect(await objectExists(a.thumb.bucketKey)).toBe(false);
    const aEntry = await db.importEntry.findUniqueOrThrow({ where: { id: a.entry.id } });
    expect([aEntry.cutoutKey, aEntry.thumbKey]).toEqual([aCut.bucketKey, aThumb.bucketKey]);
    expect(await warningsOf(a.entry.id)).toContain("recut");
    const bCut = await db.itemPhoto.findUniqueOrThrow({ where: { id: b.cutout.id } });
    expect(bCut.bucketKey).not.toBe(b.cutout.bucketKey);
    expect(await dims(bCut.bucketKey)).toEqual([600, 900]); // never turned: as photographed
    expect(lines.some((l) => l.includes("turned 90°"))).toBe(true);
    expect(await db.seedSet.findUnique({ where: { name: UNTIDY_SET } })).not.toBeNull();
    // done: a second pass touches nothing
    expect(await untidyAll()).toEqual({ recut: 0, skipped: 0, failed: 0, done: true });
    expect((await db.itemPhoto.findUniqueOrThrow({ where: { id: a.cutout.id } })).bucketKey).toBe(aCut.bucketKey);
  });

  it("a piece with no original is skipped and marked; a remove.bg failure is left for the next start, which finishes the job", async () => {
    const a = await piece();
    await deleteObject(a.entry.originalKey);
    const b = await piece();
    process.env.MOCK_REMOVE_BG_FAIL = "insufficient_credits";
    expect(await untidyAll()).toEqual({ recut: 0, skipped: 1, failed: 1, done: false });
    expect(await warningsOf(a.entry.id)).toContain("recut:no_original");
    expect(await warningsOf(b.entry.id)).not.toContain("recut");
    expect(await db.seedSet.findUnique({ where: { name: UNTIDY_SET } })).toBeNull();
    delete process.env.MOCK_REMOVE_BG_FAIL;
    expect(await untidyAll()).toEqual({ recut: 1, skipped: 0, failed: 0, done: true });
    expect(await warningsOf(b.entry.id)).toContain("recut");
  });

  it("pieces added before Smooth went live are left alone", async () => {
    const a = await piece();
    await db.importEntry.update({ where: { id: a.entry.id }, data: { createdAt: new Date("2026-10-01T12:00:00Z") } });
    expect(await untidyAll()).toEqual({ recut: 0, skipped: 0, failed: 0, done: true });
    expect((await db.itemPhoto.findUniqueOrThrow({ where: { id: a.cutout.id } })).bucketKey).toBe(a.cutout.bucketKey);
  });

  it("bestTurn finds the quarter turn that lines a fresh cutout up with the old one, by silhouette or by light", async () => {
    const plain = await sharp(await photo()).png().toBuffer();
    for (const deg of [90, 180, 270] as const) expect(await bestTurn(await rotateImage(plain, deg, "image/png"), plain)).toBe(deg);
    expect(await bestTurn(plain, plain)).toBe(0);
    // a real cutout: transparent around an off-center shape
    const cut = await sharp({ create: { width: 300, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 200, height: 120, channels: 4, background: { r: 90, g: 60, b: 30, alpha: 1 } } }).png().toBuffer(), top: 20, left: 10 }])
      .png().toBuffer();
    expect(await bestTurn(await rotateImage(cut, 270, "image/png"), cut)).toBe(270);
    expect(await bestTurn(cut, cut)).toBe(0);
  });
});

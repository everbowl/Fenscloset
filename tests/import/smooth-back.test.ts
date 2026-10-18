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
import { isSmoothConfigured, smoothGarment, transferShading } from "@/lib/images/smooth";
import { fitCutout } from "@/lib/images/thumb";

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

  it("takes only the shading from the edit: a wrinkle shadow lifts, a red stripe stays red, white paper is ignored", async () => {
    const w = 60, h = 60;
    const rgba = (fill: (x: number, y: number) => [number, number, number, number]) => {
      const b = Buffer.alloc(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, bl, a] = fill(x, y); b.set([r, g, bl, a], (y * w + x) * 4); }
      return b;
    };
    const rgb = (fill: (x: number, y: number) => [number, number, number]) => {
      const b = Buffer.alloc(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set(fill(x, y), (y * w + x) * 3);
      return b;
    };
    const px = (buf: Buffer, x: number, y: number) => [...buf.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
    // a blue garment with a dark wrinkle band (rows 20-27) and a thin red stripe (cols 40-43); the editor returns the garment flat
    const shadow = (y: number) => y >= 20 && y < 28;
    const stripe = (x: number) => x >= 40 && x < 44;
    const original = rgba((x, y) => stripe(x) ? [220, 30, 30, 255] : shadow(y) ? [15, 15, 80, 255] : [30, 30, 160, 255]);
    // the editor smoothed the band away and (badly) painted over the stripe too
    const edited = rgb(() => [30, 30, 160]);
    const out = await transferShading(original, edited, w, h);
    const lifted = px(out, 10, 24); // in the band: brightened toward the garment color
    expect(lifted[2]).toBeGreaterThan(130);
    expect(lifted[3]).toBe(255);
    const kept = px(out, 41, 50); // on the stripe: still red, not the editor's blue
    expect(kept[0]).toBeGreaterThan(150);
    expect(kept[2]).toBeLessThan(80);
    expect(px(out, 10, 50)).toEqual([30, 30, 160, 255]); // plain garment untouched
    // the editor whited out a corner of the garment: that region keeps the original
    const whited = rgb((x, y) => x < 10 && y < 10 ? [250, 250, 250] : [30, 30, 160]);
    const out2 = await transferShading(rgba(() => [30, 30, 160, 255]), whited, w, h);
    expect(px(out2, 2, 2)).toEqual([30, 30, 160, 255]);
    // transparent pixels stay transparent
    const out3 = await transferShading(rgba((x) => x < 30 ? [0, 0, 0, 0] : [30, 30, 160, 255]), edited, w, h);
    expect(px(out3, 5, 5)[3]).toBe(0);
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

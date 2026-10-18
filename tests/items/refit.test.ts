import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { getObject, newKey, objectExists, putObject } from "@/lib/storage";
import { refitCutouts } from "@/lib/items/refit";

describe("refit cutouts", () => {
  let jeffId: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_S3 = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-refit-"));
    await seed();
    jeffId = (await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } })).id;
  });

  it("trims roomy cutouts, remakes their thumbnails under new keys, and leaves fitted ones alone", async () => {
    const roomy = await sharp({ create: { width: 400, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 200, height: 300, channels: 4, background: { r: 120, g: 90, b: 60, alpha: 1 } } }).png().toBuffer(), top: 150, left: 100 }]).png().toBuffer();
    const tight = await sharp({ create: { width: 200, height: 300, channels: 4, background: { r: 120, g: 90, b: 60, alpha: 1 } } }).png().toBuffer();
    const cat = await db.category.findFirstOrThrow();
    const make = async (png: Buffer) => {
      const cutKey = newKey("cutouts", jeffId, "image/png"); await putObject(cutKey, png, "image/png");
      const thumbKey = newKey("thumbs", jeffId, "image/jpeg"); await putObject(thumbKey, await sharp(png).flatten({ background: "#fff" }).jpeg().toBuffer(), "image/jpeg");
      const item = await db.item.create({ data: { ownerId: jeffId, name: "Piece", categoryId: cat.id, photos: { create: [{ kind: "cutout", bucketKey: cutKey, isPrimary: true }, { kind: "thumb", bucketKey: thumbKey }] } } });
      return { item, cutKey, thumbKey };
    };
    const a = await make(roomy);
    const b = await make(tight);
    expect(await refitCutouts()).toEqual({ checked: 2, refit: 1 });
    const aPhotos = await db.itemPhoto.findMany({ where: { itemId: a.item.id } });
    const aCut = aPhotos.find((p) => p.kind === "cutout")!;
    expect(aCut.bucketKey).not.toBe(a.cutKey);
    expect(await objectExists(a.cutKey)).toBe(false);
    const meta = await sharp((await getObject(aCut.bucketKey)).body).metadata();
    expect(meta.width).toBe(224); expect(meta.height).toBe(324);
    expect(aPhotos.find((p) => p.kind === "thumb")!.bucketKey).not.toBe(a.thumbKey);
    const bCut = await db.itemPhoto.findFirst({ where: { itemId: b.item.id, kind: "cutout" } });
    expect(bCut!.bucketKey).toBe(b.cutKey);
    expect(await refitCutouts()).toEqual({ checked: 2, refit: 0 });
  });
});

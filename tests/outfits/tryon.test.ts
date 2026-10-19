import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { personalClosetId } from "@/lib/items/service";
import { newKey, putObject } from "@/lib/storage";
import { canViewKey } from "@/lib/photos/visibility";
import { hasBackPhoto, listTryOns, setTryOnEnabled, tryOnLook, tryOnState } from "@/lib/tryon";
import { getPrivacy } from "@/lib/profiles/service";

const jpeg = (r = 120) => sharp({ create: { width: 300, height: 400, channels: 3, background: { r, g: 110, b: 100 } } }).jpeg().toBuffer();

describe("virtual try-on", () => {
  beforeEach(async () => {
    await resetDb(); process.env.MOCK_S3 = "true"; process.env.MOCK_TRYON = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-tryon-")); await seed();
  });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });

  it("adults only, opt-in, needs a body photo; result is the owner's alone and cached", async () => {
    const [jeff, mya, brittney] = await Promise.all([by("Jeff"), by("Mya"), by("Brittney")]);
    expect(await tryOnState(mya, mya.id)).toBe("minor");
    await expect(setTryOnEnabled(mya, mya.id, true)).rejects.toMatchObject({ status: 403 });
    await expect(setTryOnEnabled(brittney, jeff.id, true)).rejects.toMatchObject({ status: 403 });
    expect(await tryOnState(jeff, jeff.id)).toBe("off");
    expect(await tryOnState(brittney, jeff.id)).toBe("not_you");
    await setTryOnEnabled(jeff, jeff.id, true);
    expect(await tryOnState(jeff, jeff.id)).toBe("no_photo");
    expect((await getPrivacy(jeff.id)).tryOn).toMatchObject({ enabled: true, adult: true, configured: true, hasBodyPhoto: false });
    const bodyKey = newKey("bodies", jeff.id, "image/jpeg"); await putObject(bodyKey, await jpeg(), "image/jpeg");
    await db.bodyPhoto.create({ data: { personId: jeff.id, bucketKey: bodyKey } });
    expect(await tryOnState(jeff, jeff.id)).toBe("ready");
    // a top with a cutout and shoes with only a plain photo
    const cat = (n: string) => db.category.findFirstOrThrow({ where: { name: n } });
    const cutKey = newKey("cutouts", jeff.id, "image/png"); await putObject(cutKey, await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(), "image/png");
    const top = await db.item.create({ data: { ownerId: jeff.id, name: "Tee", categoryId: (await cat("Tops")).id, closets: { create: [{ closetId: await personalClosetId(jeff.id) }] }, photos: { create: [{ kind: "cutout", bucketKey: cutKey, isPrimary: true }] } } });
    const shoeKey = newKey("originals", jeff.id, "image/jpeg"); await putObject(shoeKey, await jpeg(60), "image/jpeg");
    const shoes = await db.item.create({ data: { ownerId: jeff.id, name: "Sneakers", categoryId: (await cat("Shoes")).id, photos: { create: [{ kind: "alone", bucketKey: shoeKey, isPrimary: true }] } } });
    const bare = await db.item.create({ data: { ownerId: jeff.id, name: "No photo", categoryId: (await cat("Bottoms")).id } });
    const first = await tryOnLook(jeff, jeff.id, [top.id, shoes.id, bare.id], "today");
    expect(first.cached).toBe(false);
    expect(first.key).toMatch(/^tryon\//);
    expect(await canViewKey(jeff, first.key)).toBe(true);
    expect(await canViewKey(brittney, first.key)).toBe(false);
    const again = await tryOnLook(jeff, jeff.id, [shoes.id, top.id, bare.id], "today");
    expect(again).toMatchObject({ id: first.id, cached: true });
    expect((await listTryOns(jeff.id)).length).toBe(1);
    await expect(tryOnLook(jeff, jeff.id, [bare.id], "today")).rejects.toMatchObject({ status: 400 });
    await expect(tryOnLook(brittney, jeff.id, [top.id], "today")).rejects.toMatchObject({ status: 403 });
    await setTryOnEnabled(jeff, jeff.id, false);
    await expect(tryOnLook(jeff, jeff.id, [top.id], "today")).rejects.toThrow(/Settings/);
  });

  it("from behind: needs a back body photo; the back view is its own picture, cached apart from the front", async () => {
    const jeff = await by("Jeff");
    await setTryOnEnabled(jeff, jeff.id, true);
    const front = newKey("bodies", jeff.id, "image/jpeg"); await putObject(front, await jpeg(), "image/jpeg");
    await db.bodyPhoto.create({ data: { personId: jeff.id, bucketKey: front, view: "front" } });
    const cat = (n: string) => db.category.findFirstOrThrow({ where: { name: n } });
    const shoeKey = newKey("originals", jeff.id, "image/jpeg"); await putObject(shoeKey, await jpeg(60), "image/jpeg");
    const shoes = await db.item.create({ data: { ownerId: jeff.id, name: "Sneakers", categoryId: (await cat("Shoes")).id, photos: { create: [{ kind: "alone", bucketKey: shoeKey, isPrimary: true }] } } });
    expect(await hasBackPhoto(jeff.id)).toBe(false);
    await expect(tryOnLook(jeff, jeff.id, [shoes.id], "today", undefined, "back")).rejects.toThrow(/back photo/);
    const back = newKey("bodies", jeff.id, "image/jpeg"); await putObject(back, await jpeg(90), "image/jpeg");
    await db.bodyPhoto.create({ data: { personId: jeff.id, bucketKey: back, view: "back" } });
    expect(await hasBackPhoto(jeff.id)).toBe(true);
    const f = await tryOnLook(jeff, jeff.id, [shoes.id], "today");
    const b = await tryOnLook(jeff, jeff.id, [shoes.id], "today", undefined, "back");
    expect(f.view).toBe("front");
    expect(b.view).toBe("back");
    expect(b.key).not.toBe(f.key);
    expect((await tryOnLook(jeff, jeff.id, [shoes.id], "today", undefined, "back")).id).toBe(b.id); // cached per body photo
  });
});

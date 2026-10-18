import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { personalClosetId } from "@/lib/items/service";
import { newKey, objectExists, putObject } from "@/lib/storage";
import { canViewKey } from "@/lib/photos/visibility";
import { listTryOns, tryOnState } from "@/lib/tryon";
import { isMannequinConfigured, mannequinBase, mannequinLook } from "@/lib/tryon/mannequin";
import { MANNEQUIN_BASE_KEY } from "@/lib/tryon/mannequin-key";

describe("see it on a mannequin", () => {
  beforeEach(async () => {
    await resetDb(); process.env.MOCK_S3 = "true"; process.env.MOCK_TRYON = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-mann-")); await seed();
  });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });

  it("works for a minor and their parent without any body photo; sibling cannot; results visible to the minor and parents; cached", async () => {
    const [jeff, olivia, mya] = await Promise.all([by("Jeff"), by("Olivia"), by("Mya")]);
    expect(isMannequinConfigured()).toBe(true);
    expect(await tryOnState(mya, mya.id)).toBe("minor");
    expect(await objectExists(MANNEQUIN_BASE_KEY)).toBe(false);
    const base = await mannequinBase();
    expect((await sharp(base).metadata()).width).toBeGreaterThan(100);
    expect(await objectExists(MANNEQUIN_BASE_KEY)).toBe(true);
    expect(await canViewKey(olivia, MANNEQUIN_BASE_KEY)).toBe(true); // the shared figure is for everyone
    const cat = (n: string) => db.category.findFirstOrThrow({ where: { name: n } });
    const cutKey = newKey("cutouts", mya.id, "image/png"); await putObject(cutKey, await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer(), "image/png");
    const top = await db.item.create({ data: { ownerId: mya.id, name: "Tee", categoryId: (await cat("Tops")).id, closets: { create: [{ closetId: await personalClosetId(mya.id) }] }, photos: { create: [{ kind: "cutout", bucketKey: cutKey, isPrimary: true }] } } });
    const bare = await db.item.create({ data: { ownerId: mya.id, name: "No photo", categoryId: (await cat("Bottoms")).id } });
    const first = await mannequinLook(mya, mya.id, [top.id, bare.id], "today");
    expect(first).toMatchObject({ cached: false, mannequin: true });
    expect(first.key).toMatch(new RegExp(`^mannequin/${mya.id}/`));
    expect(await canViewKey(mya, first.key)).toBe(true);
    expect(await canViewKey(jeff, first.key)).toBe(true);
    expect(await canViewKey(olivia, first.key)).toBe(false);
    expect(await db.bodyPhoto.count({ where: { personId: mya.id } })).toBe(0);
    // parent dressing the minor hits the same cache; sibling is refused
    const byParent = await mannequinLook(jeff, mya.id, [bare.id, top.id], "today");
    expect(byParent).toMatchObject({ id: first.id, cached: true, mannequin: true });
    await expect(mannequinLook(olivia, mya.id, [top.id], "today")).rejects.toMatchObject({ status: 403 });
    await expect(mannequinLook(mya, mya.id, [bare.id], "today")).rejects.toMatchObject({ status: 400 });
    // the person's own try-on list (body photo results) does not mix in mannequin pictures
    expect(await listTryOns(mya.id)).toEqual([]);
    expect((await db.tryOn.findFirstOrThrow({ where: { id: first.id } })).source).toBe("mannequin:today");
  });
});

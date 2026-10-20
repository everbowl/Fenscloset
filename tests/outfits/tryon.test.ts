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
import { garmentImages, hasBackPhoto, listTryOns, setTryOnEnabled, tryOnLook, tryOnState } from "@/lib/tryon";
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
    expect(await tryOnState(jeff, jeff.id)).toBe("no_photo"); // on by default: only the body photo is missing
    expect(await tryOnState(brittney, jeff.id)).toBe("not_you");
    await setTryOnEnabled(jeff, jeff.id, false);
    expect(await tryOnState(jeff, jeff.id)).toBe("off");
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

  it("reports its steps while it dresses (the mirror shows them); a cached look reports nothing", async () => {
    const jeff = await by("Jeff");
    const bodyKey = newKey("bodies", jeff.id, "image/jpeg"); await putObject(bodyKey, await jpeg(), "image/jpeg");
    await db.bodyPhoto.create({ data: { personId: jeff.id, bucketKey: bodyKey, view: "front" } });
    const cat = (n: string) => db.category.findFirstOrThrow({ where: { name: n } });
    const pic = async () => { const k = newKey("originals", jeff.id, "image/jpeg"); await putObject(k, await jpeg(90), "image/jpeg"); return k; };
    const tee = await db.item.create({ data: { ownerId: jeff.id, name: "Tee", categoryId: (await cat("Tops")).id, photos: { create: [{ kind: "alone", bucketKey: await pic(), isPrimary: true }] } } });
    const jeans = await db.item.create({ data: { ownerId: jeff.id, name: "Jeans", categoryId: (await cat("Bottoms")).id, photos: { create: [{ kind: "alone", bucketKey: await pic(), isPrimary: true }] } } });
    const steps: string[] = [];
    await tryOnLook(jeff, jeff.id, [tee.id, jeans.id], "closet", undefined, "front", undefined, [], false, { step: (s) => steps.push(s) });
    expect(steps[0]).toBe("Dressing you · Tee, Jeans");
    expect(steps).toContain("Checking the picture…");
    expect(steps.some((s) => s.startsWith("Styling · ") && s.includes("Untucked"))).toBe(true);
    expect(steps.at(-1)).toBe("Checking the styled picture…");
    const again: string[] = [];
    await tryOnLook(jeff, jeff.id, [tee.id, jeans.id], "closet", undefined, "front", undefined, [], false, { step: (s) => again.push(s) });
    expect(again).toEqual([]);
  });

  it("styling: untucked by default on a top + bottom look, one raw picture plus one styled per set of choices; a pick is remembered", async () => {
    const jeff = await by("Jeff");
    await setTryOnEnabled(jeff, jeff.id, true);
    const bodyKey = newKey("bodies", jeff.id, "image/jpeg"); await putObject(bodyKey, await jpeg(), "image/jpeg");
    await db.bodyPhoto.create({ data: { personId: jeff.id, bucketKey: bodyKey, view: "front" } });
    const cat = (n: string) => db.category.findFirstOrThrow({ where: { name: n } });
    const sub = (n: string) => db.subcategory.findFirstOrThrow({ where: { name: n } });
    const pic = async () => { const k = newKey("originals", jeff.id, "image/jpeg"); await putObject(k, await jpeg(90), "image/jpeg"); return k; };
    const shirt = await db.item.create({ data: { ownerId: jeff.id, name: "Oxford", categoryId: (await cat("Tops")).id, subcategoryId: (await sub("Button-down")).id, features: ["button_front", "long_sleeve", "collar"], photos: { create: [{ kind: "alone", bucketKey: await pic(), isPrimary: true }] } } });
    const jeans = await db.item.create({ data: { ownerId: jeff.id, name: "Jeans", categoryId: (await cat("Bottoms")).id, photos: { create: [{ kind: "alone", bucketKey: await pic(), isPrimary: true }] } } });
    const dress = await db.item.create({ data: { ownerId: jeff.id, name: "Dress", categoryId: (await cat("Dresses")).id, photos: { create: [{ kind: "alone", bucketKey: await pic(), isPrimary: true }] } } });

    const first = await tryOnLook(jeff, jeff.id, [shirt.id, jeans.id], "today");
    expect(first.cached).toBe(false);
    expect(first.styling?.groups.map((g) => g.name)).toEqual(["Tuck", "Buttons", "Sleeves", "Collar", "Hem"]);
    expect(first.styling?.summary).toBe("Untucked · Top one open · Down · Down · As is");
    expect(first.styling?.poses[0]?.name).toBe("Standing, as photographed");
    const rows = await db.tryOn.findMany({ where: { personId: jeff.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.styling === null)).toEqual([true, false]); // the raw try-on, then the styled picture
    expect(first.key).toBe(rows[1].bucketKey);
    expect(rows[1].styling).toMatch(/^pose=.+;.+=.+/);
    // same look again: the styled picture comes straight back
    const again = await tryOnLook(jeff, jeff.id, [jeans.id, shirt.id], "today");
    expect(again).toMatchObject({ id: first.id, cached: true });
    expect(await db.tryOn.count({ where: { personId: jeff.id } })).toBe(2);
    // a chip: tucked + top two open → one more styled picture, no second dressing
    const tuck = first.styling!.groups.find((g) => g.name === "Tuck")!;
    const tucked = await tryOnLook(jeff, jeff.id, [shirt.id, jeans.id], "today", undefined, "front", { options: { [tuck.id]: tuck.options.find((o) => o.name === "Tucked")!.id } });
    expect(tucked.cached).toBe(false);
    expect(tucked.styling?.summary).toBe("Tucked · Top one open · Down · Down · As is");
    expect(await db.tryOn.count({ where: { personId: jeff.id } })).toBe(3);
    expect(await db.tryOn.count({ where: { personId: jeff.id, styling: null } })).toBe(1);
    // remembered: the next look opens tucked; a pose rides along too
    const remembered = await tryOnLook(jeff, jeff.id, [shirt.id, jeans.id], "today");
    expect(remembered).toMatchObject({ id: tucked.id, cached: true });
    const pockets = first.styling!.poses.find((p) => p.name === "Hands in pockets")!;
    const posed = await tryOnLook(jeff, jeff.id, [shirt.id, jeans.id], "today", undefined, "front", { poseId: pockets.id });
    expect(posed.styling?.summary).toBe("Tucked · Top one open · Down · Down · As is · Hands in pockets");
    expect(posed.styling?.poseId).toBe(pockets.id);
    expect((await db.person.findUniqueOrThrow({ where: { id: jeff.id } })).mirrorPrefs).toMatchObject({ poseId: pockets.id });
    // a dress alone: no tuck, nothing to change → just the raw try-on, and the history lists only the styled pictures of the shirt look
    const alone = await tryOnLook(jeff, jeff.id, [dress.id], "today", undefined, "front", { poseId: null });
    expect(alone.styling?.groups).toEqual([]);
    expect(alone.styling?.summary).toBe("");
    expect((await db.tryOn.findUniqueOrThrow({ where: { id: alone.id } })).styling).toBeNull();
    const history = await listTryOns(jeff.id);
    expect(history.map((h) => h.id)).toEqual([alone.id, posed.id, tucked.id, first.id]);
  });


  it("garment pictures: a photo that does not show the whole piece is passed over (checked once); the person's own choice wins", async () => {
    process.env.MOCK_AI = "true";
    const jeff = await by("Jeff");
    const cat = (n: string) => db.category.findFirstOrThrow({ where: { name: n } });
    const png = async () => { const k = newKey("cutouts", jeff.id, "image/png"); await putObject(k, await sharp({ create: { width: 120, height: 120, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } } }).png().toBuffer(), "image/png"); return k; };
    const jpg = async (r: number) => { const k = newKey("originals", jeff.id, "image/jpeg"); await putObject(k, await jpeg(r), "image/jpeg"); return k; };
    const buf = async (k: string) => (await import("@/lib/storage")).getObject(k).then((o) => o.body);
    const cutKey = await png(); const retailKey = await jpg(70); const aloneKey = await jpg(50);
    const polo = await db.item.create({ data: { ownerId: jeff.id, name: "Polo", categoryId: (await cat("Tops")).id, photos: { create: [{ kind: "alone", bucketKey: aloneKey }, { kind: "cutout", bucketKey: cutKey, isPrimary: true, wholeGarment: false }, { kind: "retail", bucketKey: retailKey }] } } });
    // the cutout was found folded before: the store photo is checked (whole) and used; the cutout is not looked at again
    let [g] = await garmentImages([polo.id]);
    expect(g.buf.equals(await buf(retailKey))).toBe(true);
    expect((await db.itemPhoto.findFirstOrThrow({ where: { bucketKey: retailKey } })).wholeGarment).toBe(true);
    expect((await db.itemPhoto.findFirstOrThrow({ where: { bucketKey: aloneKey } })).wholeGarment).toBeNull(); // never needed
    // the person says "use this one in the mirror": the cutout, folded or not; tapping again hands the pick back to the app
    const { setMirrorPhoto } = await import("@/lib/items/service");
    const cut = await db.itemPhoto.findFirstOrThrow({ where: { bucketKey: cutKey } });
    expect(await setMirrorPhoto(jeff, cut.id)).toEqual({ photoId: cut.id });
    [g] = await garmentImages([polo.id]);
    expect(g.buf.equals(await buf(cutKey))).toBe(true);
    expect(await setMirrorPhoto(jeff, cut.id)).toEqual({ photoId: null });
    [g] = await garmentImages([polo.id]);
    expect(g.buf.equals(await buf(retailKey))).toBe(true);
    // every photo of a piece fails the check: the first in line is still used (a try-on beats none), and the answers are kept.
    // The person's own photo comes before the cutout: a cutout can have a background-removal hole, which is how a tee lost its hem.
    process.env.MOCK_GARMENT_WHOLE = "false";
    const cut2 = await png(); const alone2 = await jpg(30);
    const tee = await db.item.create({ data: { ownerId: jeff.id, name: "Tee", categoryId: (await cat("Tops")).id, photos: { create: [{ kind: "alone", bucketKey: alone2 }, { kind: "cutout", bucketKey: cut2, isPrimary: true }] } } });
    [g] = await garmentImages([tee.id]);
    expect(g.buf.equals(await buf(alone2))).toBe(true);
    expect((await db.itemPhoto.findMany({ where: { itemId: tee.id } })).map((p) => p.wholeGarment)).toEqual([false, false]);
    delete process.env.MOCK_GARMENT_WHOLE;
    // a photo change forgets every picture made with the piece, and "Dress again" dresses one look from scratch
    const bodyKey = newKey("bodies", jeff.id, "image/jpeg"); await putObject(bodyKey, await jpeg(), "image/jpeg");
    await db.bodyPhoto.create({ data: { personId: jeff.id, bucketKey: bodyKey, view: "front" } });
    await setTryOnEnabled(jeff, jeff.id, true);
    const first = await tryOnLook(jeff, jeff.id, [polo.id], "today");
    expect((await tryOnLook(jeff, jeff.id, [polo.id], "today")).id).toBe(first.id);
    const redone = await tryOnLook(jeff, jeff.id, [polo.id], "today", undefined, "front", undefined, [], true);
    expect(redone.id).not.toBe(first.id);
    expect(await db.tryOn.count({ where: { personId: jeff.id } })).toBe(1);
    const { forgetTryOns } = await import("@/lib/tryon");
    expect(await forgetTryOns(polo.id)).toBe(1);
    expect(await db.tryOn.count({ where: { personId: jeff.id } })).toBe(0);
    // the render check is not satisfied even after the second dressing: the picture still comes, with the note under it
    process.env.MOCK_RENDER_OK = "false";
    const unsure = await tryOnLook(jeff, jeff.id, [polo.id], "today");
    expect(unsure.note).toMatch(/isn’t sure/);
    delete process.env.MOCK_RENDER_OK;
    delete process.env.MOCK_GARMENT_WHOLE;
    delete process.env.MOCK_AI;
  });

});

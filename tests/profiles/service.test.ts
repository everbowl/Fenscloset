import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { newKey, putObject } from "@/lib/storage";
import { canViewKey } from "@/lib/photos/visibility";
import { bodyPhotosAllowed, canSeeBodyData, canShopFor } from "@/lib/people/visibility";
import { addBodyPhoto, getBodyProfile, setBodyPhotoPrivacy, getPrivacy, getStyleProfile, setBodyViewers, setMeasurement, setMinorBodyImageApproval, setShoppers, updateFavorites, updateStyle } from "@/lib/profiles/service";
import { setMyBrand } from "@/lib/profiles/brands";
import { listEntries } from "@/lib/lists/service";

describe("profiles & privacy", () => {
  beforeEach(async () => {
    await resetDb(); process.env.MOCK_S3 = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-prof-"));
    await seed();
  });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });

  it("body data: Devon invisible to Casey, visible to Avery; a grant opens Avery's to Casey; minors cannot grant", async () => {
    const [avery, casey, devon, blake] = await Promise.all([by("Avery"), by("Casey"), by("Devon"), by("Blake")]);
    const kinds = await listEntries("measurementKind");
    expect(kinds.map((k) => k.name)).toContain("Waist");
    await setMeasurement(devon, devon.id, kinds[0].id, "62");
    expect(await canSeeBodyData(casey, devon.id)).toBe(false);
    expect(await getBodyProfile(casey, devon.id)).toBeNull();
    expect(await canSeeBodyData(avery, devon.id)).toBe(true);
    expect((await getBodyProfile(avery, devon.id))!.measurements[0].value).toBe("62");
    expect(await canSeeBodyData(blake, avery.id)).toBe(false); // admins get nothing automatically
    await setBodyViewers(avery, avery.id, [casey.id]);
    expect(await canSeeBodyData(casey, avery.id)).toBe(true);
    expect((await getPrivacy(avery.id)).bodyViewerIds).toEqual([casey.id]);
    await expect(setBodyViewers(devon, devon.id, [casey.id])).rejects.toMatchObject({ status: 403 });
    await expect(setBodyViewers(casey, avery.id, [casey.id])).rejects.toMatchObject({ status: 403 });
    expect((await getPrivacy(devon.id))).toMatchObject({ canGrant: false, parentIds: expect.arrayContaining([avery.id, blake.id]) });
    // parent can edit the minor's measurements; sibling cannot
    await setMeasurement(avery, devon.id, kinds[1].id, "100");
    await expect(setMeasurement(casey, devon.id, kinds[1].id, "100")).rejects.toMatchObject({ status: 403 });
  });

  it("shop-for: parents implicit for minors, adults grant explicitly", async () => {
    const [avery, casey, devon] = await Promise.all([by("Avery"), by("Casey"), by("Devon")]);
    expect(await canShopFor(avery, devon.id)).toBe(true);
    expect(await canShopFor(casey, devon.id)).toBe(false);
    expect(await canShopFor(casey, avery.id)).toBe(false);
    await setShoppers(avery, avery.id, [casey.id]);
    expect(await canShopFor(casey, avery.id)).toBe(true);
    await expect(setShoppers(devon, devon.id, [casey.id])).rejects.toMatchObject({ status: 403 });
  });

  it("body photos: Devon is approved by Avery (seed); revoking deletes photos; photo keys obey the body rule", async () => {
    const [avery, casey, devon] = await Promise.all([by("Avery"), by("Casey"), by("Devon")]);
    expect(await bodyPhotosAllowed(devon.id)).toMatchObject({ allowed: true, approvedBy: "Avery" });
    const key = newKey("bodies", devon.id, "image/jpeg");
    await putObject(key, Buffer.from("x"), "image/jpeg");
    await addBodyPhoto(devon, devon.id, key);
    expect((await getBodyProfile(avery, devon.id))!.photos).toHaveLength(1);
    expect(await canViewKey(avery, key)).toBe(true);
    expect(await canViewKey(casey, key)).toBe(false);
    await expect(setMinorBodyImageApproval(casey, devon.id, false)).rejects.toMatchObject({ status: 403 });
    await setMinorBodyImageApproval(avery, devon.id, false);
    expect(await bodyPhotosAllowed(devon.id)).toMatchObject({ allowed: false });
    expect(await db.bodyPhoto.count()).toBe(0);
    await expect(addBodyPhoto(devon, devon.id, newKey("bodies", devon.id, "image/jpeg"))).rejects.toThrow(/approval/);
    await setMinorBodyImageApproval(avery, devon.id, true);
    expect(await bodyPhotosAllowed(devon.id)).toMatchObject({ allowed: true });
  });

  it("a photo locked 'only me' is invisible even to granted viewers; a minor's stays with parents", async () => {
    const [avery, casey, devon, blake] = await Promise.all([by("Avery"), by("Casey"), by("Devon"), by("Blake")]);
    await setBodyViewers(avery, avery.id, [casey.id, blake.id]);
    const locked = newKey("bodies", avery.id, "image/jpeg"); const open = newKey("bodies", avery.id, "image/jpeg");
    await putObject(locked, Buffer.from("u"), "image/jpeg"); await putObject(open, Buffer.from("s"), "image/jpeg");
    await addBodyPhoto(avery, avery.id, locked, { onlyMe: true });
    await addBodyPhoto(avery, avery.id, open, { view: "back" });
    expect((await getBodyProfile(avery, avery.id))!.photos.map((p) => p.view).sort()).toEqual(["back", "front"]);
    expect((await getBodyProfile(avery, avery.id))!.photos.map((p) => p.onlyMe).sort()).toEqual([false, true]);
    expect((await getBodyProfile(casey, avery.id))!.photos.map((p) => p.key)).toEqual([open]);
    expect((await getBodyProfile(blake, avery.id))!.photos.map((p) => p.key)).toEqual([open]);
    expect(await canViewKey(blake, locked)).toBe(false);
    expect(await canViewKey(casey, locked)).toBe(false);
    expect(await canViewKey(casey, open)).toBe(true);
    expect(await canViewKey(avery, locked)).toBe(true);
    const id = (await db.bodyPhoto.findUniqueOrThrow({ where: { bucketKey: locked } })).id;
    await expect(setBodyPhotoPrivacy(casey, avery.id, id, false)).rejects.toMatchObject({ status: 403 });
    await setBodyPhotoPrivacy(avery, avery.id, id, false);
    expect(await canViewKey(casey, locked)).toBe(true);
    // minor: locked photo still visible to parents, never to a sibling
    const devonKey = newKey("bodies", devon.id, "image/jpeg"); await putObject(devonKey, Buffer.from("m"), "image/jpeg");
    await addBodyPhoto(devon, devon.id, devonKey, { onlyMe: true });
    expect(await canViewKey(avery, devonKey)).toBe(true);
    expect(await canViewKey(casey, devonKey)).toBe(false);
    expect((await getBodyProfile(avery, devon.id))!.photos).toHaveLength(1);
  });

  it("sizes by brand, style and favorites round-trip", async () => {
    const avery = await by("Avery");
    const nike = (await listEntries("brand")).find((b) => b.name === "Nike")!;
    const tops = (await listEntries("category")).find((c) => c.name === "Tops")!;
    await setMyBrand(avery, avery.id, { brandId: nike.id, sizes: [{ categoryId: tops.id, size: "L" }] });
    await setMyBrand(avery, avery.id, { brandId: nike.id, sizes: [{ categoryId: tops.id, size: "XL" }] }); // same brand+category updates
    const body = (await getBodyProfile(avery, avery.id))!;
    expect(body.sizes).toHaveLength(1);
    expect(body.sizes[0]).toMatchObject({ brandName: "Nike", categoryName: "Tops", size: "XL" });
    const colors = await listEntries("color");
    const words = await listEntries("styleWord");
    await updateStyle(avery, avery.id, { lovedColorIds: [colors[0].id, colors[1].id], avoidColorIds: [colors[2].id], styleWordIds: [words[0].id] });
    expect(await getStyleProfile(avery.id)).toMatchObject({ lovedColorIds: [colors[0].id, colors[1].id], avoidColorIds: [colors[2].id], styleWordIds: [words[0].id] });
    await updateFavorites(avery, avery.id, { brandIds: [nike.id] });
    expect((await db.person.findUniqueOrThrow({ where: { id: avery.id }, include: { favoriteBrands: true } })).favoriteBrands.map((b) => b.name)).toEqual(["Nike"]);
  });
});

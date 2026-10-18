import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { newKey, putObject } from "@/lib/storage";
import { canViewKey } from "@/lib/photos/visibility";
import { bodyPhotosAllowed, canSeeBodyData, canShopFor } from "@/lib/people/visibility";
import { addBodyPhoto, getBodyProfile, setBodyPhotoPrivacy, getPrivacy, getStyleProfile, setBodyViewers, setMeasurement, setMinorBodyImageApproval, setShoppers, updateFavorites, updateStyle, upsertSize } from "@/lib/profiles/service";
import { listEntries } from "@/lib/lists/service";

describe("profiles & privacy", () => {
  beforeEach(async () => {
    await resetDb(); process.env.DEV_MODE = "true"; process.env.MOCK_S3 = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-prof-"));
    await seed();
  });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });

  it("body data: Mya invisible to Olivia, visible to Jeff; a grant opens Jeff's to Olivia; minors cannot grant", async () => {
    const [jeff, olivia, mya, brittney] = await Promise.all([by("Jeff"), by("Olivia"), by("Mya"), by("Brittney")]);
    const kinds = await listEntries("measurementKind");
    expect(kinds.map((k) => k.name)).toContain("Waist");
    await setMeasurement(mya, mya.id, kinds[0].id, "62");
    expect(await canSeeBodyData(olivia, mya.id)).toBe(false);
    expect(await getBodyProfile(olivia, mya.id)).toBeNull();
    expect(await canSeeBodyData(jeff, mya.id)).toBe(true);
    expect((await getBodyProfile(jeff, mya.id))!.measurements[0].value).toBe("62");
    expect(await canSeeBodyData(brittney, jeff.id)).toBe(false); // admins get nothing automatically
    await setBodyViewers(jeff, jeff.id, [olivia.id]);
    expect(await canSeeBodyData(olivia, jeff.id)).toBe(true);
    expect((await getPrivacy(jeff.id)).bodyViewerIds).toEqual([olivia.id]);
    await expect(setBodyViewers(mya, mya.id, [olivia.id])).rejects.toMatchObject({ status: 403 });
    await expect(setBodyViewers(olivia, jeff.id, [olivia.id])).rejects.toMatchObject({ status: 403 });
    expect((await getPrivacy(mya.id))).toMatchObject({ canGrant: false, parentIds: expect.arrayContaining([jeff.id, brittney.id]) });
    // parent can edit the minor's measurements; sibling cannot
    await setMeasurement(jeff, mya.id, kinds[1].id, "100");
    await expect(setMeasurement(olivia, mya.id, kinds[1].id, "100")).rejects.toMatchObject({ status: 403 });
  });

  it("shop-for: parents implicit for minors, adults grant explicitly", async () => {
    const [jeff, olivia, mya] = await Promise.all([by("Jeff"), by("Olivia"), by("Mya")]);
    expect(await canShopFor(jeff, mya.id)).toBe(true);
    expect(await canShopFor(olivia, mya.id)).toBe(false);
    expect(await canShopFor(olivia, jeff.id)).toBe(false);
    await setShoppers(jeff, jeff.id, [olivia.id]);
    expect(await canShopFor(olivia, jeff.id)).toBe(true);
    await expect(setShoppers(mya, mya.id, [olivia.id])).rejects.toMatchObject({ status: 403 });
  });

  it("body photos: Mya is approved by Jeff (seed); revoking deletes photos; photo keys obey the body rule", async () => {
    const [jeff, olivia, mya] = await Promise.all([by("Jeff"), by("Olivia"), by("Mya")]);
    expect(await bodyPhotosAllowed(mya.id)).toMatchObject({ allowed: true, approvedBy: "Jeff" });
    const key = newKey("bodies", mya.id, "image/jpeg");
    await putObject(key, Buffer.from("x"), "image/jpeg");
    await addBodyPhoto(mya, mya.id, key);
    expect((await getBodyProfile(jeff, mya.id))!.photos).toHaveLength(1);
    expect(await canViewKey(jeff, key)).toBe(true);
    expect(await canViewKey(olivia, key)).toBe(false);
    await expect(setMinorBodyImageApproval(olivia, mya.id, false)).rejects.toMatchObject({ status: 403 });
    await setMinorBodyImageApproval(jeff, mya.id, false);
    expect(await bodyPhotosAllowed(mya.id)).toMatchObject({ allowed: false });
    expect(await db.bodyPhoto.count()).toBe(0);
    await expect(addBodyPhoto(mya, mya.id, newKey("bodies", mya.id, "image/jpeg"))).rejects.toThrow(/approval/);
    await setMinorBodyImageApproval(jeff, mya.id, true);
    expect(await bodyPhotosAllowed(mya.id)).toMatchObject({ allowed: true });
  });

  it("a photo locked 'only me' is invisible even to granted viewers; a minor's stays with parents", async () => {
    const [jeff, olivia, mya, brittney] = await Promise.all([by("Jeff"), by("Olivia"), by("Mya"), by("Brittney")]);
    await setBodyViewers(jeff, jeff.id, [olivia.id, brittney.id]);
    const locked = newKey("bodies", jeff.id, "image/jpeg"); const open = newKey("bodies", jeff.id, "image/jpeg");
    await putObject(locked, Buffer.from("u"), "image/jpeg"); await putObject(open, Buffer.from("s"), "image/jpeg");
    await addBodyPhoto(jeff, jeff.id, locked, { onlyMe: true });
    await addBodyPhoto(jeff, jeff.id, open);
    expect((await getBodyProfile(jeff, jeff.id))!.photos.map((p) => p.onlyMe).sort()).toEqual([false, true]);
    expect((await getBodyProfile(olivia, jeff.id))!.photos.map((p) => p.key)).toEqual([open]);
    expect((await getBodyProfile(brittney, jeff.id))!.photos.map((p) => p.key)).toEqual([open]);
    expect(await canViewKey(brittney, locked)).toBe(false);
    expect(await canViewKey(olivia, locked)).toBe(false);
    expect(await canViewKey(olivia, open)).toBe(true);
    expect(await canViewKey(jeff, locked)).toBe(true);
    const id = (await db.bodyPhoto.findUniqueOrThrow({ where: { bucketKey: locked } })).id;
    await expect(setBodyPhotoPrivacy(olivia, jeff.id, id, false)).rejects.toMatchObject({ status: 403 });
    await setBodyPhotoPrivacy(jeff, jeff.id, id, false);
    expect(await canViewKey(olivia, locked)).toBe(true);
    // minor: locked photo still visible to parents, never to a sibling
    const myaKey = newKey("bodies", mya.id, "image/jpeg"); await putObject(myaKey, Buffer.from("m"), "image/jpeg");
    await addBodyPhoto(mya, mya.id, myaKey, { onlyMe: true });
    expect(await canViewKey(jeff, myaKey)).toBe(true);
    expect(await canViewKey(olivia, myaKey)).toBe(false);
    expect((await getBodyProfile(jeff, mya.id))!.photos).toHaveLength(1);
  });

  it("sizes by brand, style and favorites round-trip", async () => {
    const jeff = await by("Jeff");
    const nike = (await listEntries("brand")).find((b) => b.name === "Nike")!;
    const tops = (await listEntries("category")).find((c) => c.name === "Tops")!;
    await upsertSize(jeff, jeff.id, { brandId: nike.id, categoryId: tops.id, size: "L" });
    await upsertSize(jeff, jeff.id, { brandId: nike.id, categoryId: tops.id, size: "XL" }); // same brand+category updates
    const body = (await getBodyProfile(jeff, jeff.id))!;
    expect(body.sizes).toHaveLength(1);
    expect(body.sizes[0]).toMatchObject({ brandName: "Nike", categoryName: "Tops", size: "XL" });
    const colors = await listEntries("color");
    const words = await listEntries("styleWord");
    await updateStyle(jeff, jeff.id, { lovedColorIds: [colors[0].id, colors[1].id], avoidColorIds: [colors[2].id], styleWordIds: [words[0].id] });
    expect(await getStyleProfile(jeff.id)).toMatchObject({ lovedColorIds: [colors[0].id, colors[1].id], avoidColorIds: [colors[2].id], styleWordIds: [words[0].id] });
    await updateFavorites(jeff, jeff.id, { brandIds: [nike.id] });
    expect((await db.person.findUniqueOrThrow({ where: { id: jeff.id }, include: { favoriteBrands: true } })).favoriteBrands.map((b) => b.name)).toEqual(["Nike"]);
  });
});

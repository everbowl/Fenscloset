import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { listNeeds, noteBodyPhotoProblem, snoozeNeed } from "@/lib/closet/needs";
import { setMyBrand } from "@/lib/profiles/brands";
import { addBodyPhoto } from "@/lib/profiles/service";

describe("what's needed on the closet page (Jeff, 2 Nov 2026, D1)", () => {
  let jeff: { id: string; role: "admin" };
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_TRYON = "true"; process.env.MOCK_S3 = "true";
    await seed();
    jeff = { id: (await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } })).id, role: "admin" };
  });
  const keys = async () => (await listNeeds(jeff, jeff.id)).map((n) => n.key);
  const front = (file: string) => addBodyPhoto(jeff, jeff.id, `bodies/${jeff.id}/${file}0000000000.jpg`, { view: "front" });

  it("one row per gap, most pressing first; each fix clears its row", async () => {
    // a fresh adult with the mirror on: the front photo is the only gap (Jeff shops in Men's by the seed)
    expect(await keys()).toEqual(["body-front"]);
    const everlane = await db.brand.upsert({ where: { name: "Everlane" }, update: {}, create: { name: "Everlane" } });
    await db.person.update({ where: { id: jeff.id }, data: { favoriteBrands: { connect: { id: everlane.id } } } });
    const tops = await db.category.findFirstOrThrow({ where: { name: "Tops" } });
    await db.item.create({ data: { ownerId: jeff.id, categoryId: tops.id, name: "Store tee", storePhoto: true } });
    await db.item.create({ data: { ownerId: jeff.id, categoryId: tops.id, name: "Gone tee", storePhoto: true, retiredAt: new Date() } }); // retired pieces do not count
    await db.person.update({ where: { id: jeff.id }, data: { shopSectionId: null } });
    expect(await keys()).toEqual(["body-front", "section", `size-${everlane.id}`, "store-photos"]);
    const needs = await listNeeds(jeff, jeff.id);
    expect(needs.find((n) => n.kind === "store-photos")).toMatchObject({ count: 1, title: "1 piece still wears the store’s photo" });
    expect(needs.find((n) => n.kind === "size")).toMatchObject({ brandId: everlane.id, brandName: "Everlane", title: "Your size in Everlane" });
    expect(needs.find((n) => n.kind === "body-front")).toMatchObject({ view: "front" });

    await setMyBrand(jeff, jeff.id, { brandId: everlane.id, sizes: [{ categoryId: tops.id, size: "M" }] });
    await front("front");
    expect(await keys()).toEqual(["section", "store-photos", "body-back"]); // a back photo is asked for only once there is a front
    await db.item.updateMany({ where: { ownerId: jeff.id }, data: { storePhoto: false } });
    await db.person.update({ where: { id: jeff.id }, data: { shopSection: { connect: { name: "Men's" } } } });
    expect(await keys()).toEqual(["body-back"]);
    await addBodyPhoto(jeff, jeff.id, `bodies/${jeff.id}/back0000000000.jpg`, { view: "back" });
    expect(await keys()).toEqual([]);
  });

  it("an engine that could not make out the body asks for a retake first; a dressing that works, or a newer photo, clears it", async () => {
    await front("front");
    const photo = await db.bodyPhoto.findFirstOrThrow({ where: { personId: jeff.id } });
    await noteBodyPhotoProblem(photo.id, "FASHN could not make out the body in this photo.");
    const needs = await listNeeds(jeff, jeff.id);
    expect(needs[0]).toMatchObject({ key: "body-retake", kind: "body-retake", view: "front", detail: "FASHN could not make out the body in this photo." });
    await noteBodyPhotoProblem(photo.id, null);
    expect(await keys()).toEqual(["body-back"]);
    await noteBodyPhotoProblem(photo.id, "x");
    await front("front2");
    await db.bodyPhoto.update({ where: { bucketKey: `bodies/${jeff.id}/front20000000000.jpg` }, data: { takenAt: new Date(Date.now() + 60_000) } });
    expect(await keys()).toEqual(["body-back"]); // the newest front photo is the one the mirror uses
    await noteBodyPhotoProblem("gone", "x"); // a photo removed meanwhile is no error
  });

  it("minors and people with the mirror off get no body rows; nobody is nudged about another person's closet", async () => {
    const mya = await db.person.findFirstOrThrow({ where: { name: "Mya" } });
    expect(mya.role).toBe("minor");
    expect((await listNeeds({ id: mya.id, role: "minor" }, mya.id)).map((n) => n.kind)).toEqual(["section"]);
    await db.person.update({ where: { id: jeff.id }, data: { tryOnEnabled: false } });
    expect(await keys()).toEqual([]);
    expect(await listNeeds(jeff, mya.id)).toEqual([]);
  });

  it("Not now hides a row for the household's days, then it comes back; only real rows can be hidden", async () => {
    await expect(snoozeNeed(jeff, "nope")).rejects.toThrow("not one of the needs");
    const until = await snoozeNeed(jeff, "body-front");
    expect(Math.round((until.getTime() - Date.now()) / 86_400_000)).toBe(30);
    expect(await keys()).toEqual([]);
    await db.needSnooze.update({ where: { personId_key: { personId: jeff.id, key: "body-front" } }, data: { until: new Date(Date.now() - 1000) } });
    expect(await keys()).toEqual(["body-front"]);
    await db.rule.update({ where: { key: "needSnoozeDays" }, data: { value: "7" } });
    const again = await snoozeNeed(jeff, "body-front");
    expect(Math.round((again.getTime() - Date.now()) / 86_400_000)).toBe(7);
    expect(await keys()).toEqual([]);
  });
});

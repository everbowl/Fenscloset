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
import { addPieces, addToLook, deleteLook, getLook, listLooks, lookGarments, MAX_LOOK_PIECES, openLook, removePiece, saveLook } from "@/lib/looks/service";
import { dressOnMe, tryOnLook } from "@/lib/tryon";
import { mannequinLook } from "@/lib/tryon/mannequin";
import { addBodyPhoto } from "@/lib/profiles/service";

type P = { id: string; role: "admin" | "member" | "minor" };

describe("looks: things to buy and things owned, together on you (Jeff, 2 Nov 2026, B1)", () => {
  let jeff: P, olivia: P, mya: P;
  let tops: string, bottoms: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_S3 = "true"; process.env.MOCK_TRYON = "true"; process.env.MOCK_FETCH = "true"; process.env.MOCK_AI = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-looks-"));
    await seed();
    const by = async (name: string) => { const p = await db.person.findFirstOrThrow({ where: { name } }); return { id: p.id, role: p.role } as P; };
    [jeff, olivia, mya] = await Promise.all([by("Jeff"), by("Olivia"), by("Mya")]);
    tops = (await db.category.findFirstOrThrow({ where: { name: "Tops" } })).id;
    bottoms = (await db.category.findFirstOrThrow({ where: { name: "Bottoms" } })).id;
  });
  const find = (n: number, extra: Partial<{ category: string | null; priceText: string | null }> = {}) => ({ title: `Store find ${n}`, url: `https://mock.example/shop/find/${n}`, storeName: "Everlane", priceText: `$${40 + n}.00`, imageUrl: `https://mock.example/img/${n}.jpg`, category: "Tops", ...extra });
  async function piece(owner: P, name: string, categoryId: string, withPhoto = true) {
    const key = newKey("cutouts", owner.id, "image/png");
    if (withPhoto) await putObject(key, await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 40, g: 40, b: 120, alpha: 1 } } }).png().toBuffer(), "image/png");
    return db.item.create({ data: { ownerId: owner.id, name, categoryId, closets: { create: [{ closetId: await personalClosetId(owner.id) }] }, ...(withPhoto ? { photos: { create: [{ kind: "cutout", bucketKey: key, isPrimary: true }] } } : {}) } });
  }

  it("Add to a look starts the open look, keeps a piece once, holds five, and naming it saves it under Fits", async () => {
    expect(await openLook(jeff.id)).toBeNull();
    const r1 = await addToLook(jeff, jeff.id, find(1));
    expect(r1).toMatchObject({ count: 1, added: true });
    expect(await openLook(jeff.id)).toEqual({ id: r1.lookId, pieces: 1 });
    expect(await addToLook(jeff, jeff.id, find(1))).toMatchObject({ lookId: r1.lookId, count: 1, added: false }); // the same link twice is kept once
    const jeans = await piece(jeff, "Dark jeans", bottoms);
    expect(await addToLook(jeff, jeff.id, { itemId: jeans.id })).toMatchObject({ lookId: r1.lookId, count: 2, added: true });
    expect(await addToLook(jeff, jeff.id, { itemId: jeans.id })).toMatchObject({ count: 2, added: false });
    const view = (await getLook(jeff, r1.lookId))!;
    expect(view).toMatchObject({ name: null, savedAt: null, toBuy: 1, total: 41, canEdit: true, personName: "Jeff" });
    expect(view.pieces.map((p) => [p.kind, p.name])).toEqual([["store", "Store find 1"], ["closet", "Dark jeans"]]);
    expect(view.pieces[0]).toMatchObject({ url: find(1).url, storeName: "Everlane", priceText: "$41.00", category: "Tops", imageUrl: find(1).imageUrl });
    expect(view.pieces[1]).toMatchObject({ itemId: jeans.id, category: "Bottoms" });
    // room for five, no more
    await addPieces(jeff, r1.lookId, [find(2), find(3), find(4)]);
    await expect(addToLook(jeff, jeff.id, find(5))).rejects.toThrow(`up to ${MAX_LOOK_PIECES} pieces`);
    await removePiece(jeff, r1.lookId, view.pieces[0].id);
    expect((await getLook(jeff, r1.lookId))!.pieces).toHaveLength(4);
    // a piece from someone else's closet, or a find without a link or picture, is refused
    const hers = await piece(olivia, "Olivia's tee", tops);
    await expect(addToLook(jeff, jeff.id, { itemId: hers.id })).rejects.toThrow("isn’t in the closet");
    await expect(addToLook(jeff, jeff.id, { title: "Nothing to show" })).rejects.toThrow("needs a link or a picture");
    // naming it saves it: it leaves the tray and lands under Fits → Looks; the next Add starts a new open look
    await expect(saveLook(jeff, r1.lookId, "  ")).rejects.toThrow("name");
    await saveLook(jeff, r1.lookId, "Date night");
    expect(await openLook(jeff.id)).toBeNull();
    expect(await listLooks(jeff, jeff.id)).toMatchObject([{ id: r1.lookId, name: "Date night", pieces: 4, toBuy: 3 }]);
    const r2 = await addToLook(jeff, jeff.id, find(9));
    expect(r2.lookId).not.toBe(r1.lookId);
    expect(await openLook(jeff.id)).toEqual({ id: r2.lookId, pieces: 1 });
    await saveLook(jeff, r1.lookId, "Date night, take two"); // renaming keeps it saved
    expect((await listLooks(jeff, jeff.id))[0].name).toBe("Date night, take two");
    await deleteLook(jeff, r1.lookId);
    expect(await listLooks(jeff, jeff.id)).toEqual([]);
    expect(await getLook(jeff, r1.lookId)).toBeNull();
  });

  it("whoever may shop for the person may build their look: the person, a parent of a minor, a shopper they allowed; nobody else", async () => {
    await expect(addToLook(olivia, jeff.id, find(1))).rejects.toThrow("Only the person");
    const forMya = await addToLook(jeff, mya.id, find(2)); // Jeff is Mya's parent
    expect((await getLook(jeff, forMya.lookId))!.personName).toBe("Mya");
    expect(await getLook(olivia, forMya.lookId)).toBeNull();
    expect(await listLooks(olivia, mya.id)).toEqual([]);
    await db.shopForGrant.create({ data: { ownerId: jeff.id, shopperId: olivia.id } });
    const byOlivia = await addToLook(olivia, jeff.id, find(3));
    expect((await getLook(jeff, byOlivia.lookId))!.pieces[0].name).toBe("Store find 3");
    expect((await db.look.findUniqueOrThrow({ where: { id: byOlivia.lookId } })).byId).toBe(olivia.id);
  });

  it("the mirror dresses the mix: store finds ride along as extra garments, fetched once into the bucket, cached by the look", async () => {
    // Mya (a minor): the mannequin, never a body photo
    const myaJeans = await piece(mya, "Mya jeans", bottoms);
    const look = await addToLook(jeff, mya.id, find(4, { category: "Tops" }));
    await addPieces(jeff, look.lookId, [{ itemId: myaJeans.id }, { title: "No picture", url: "https://mock.example/shop/bare" }]);
    const g = await lookGarments(look.lookId);
    expect(g.itemIds).toEqual([myaJeans.id]);
    expect(g.extras.map((e) => [e.name, e.category])).toEqual([["Store find 4", "Tops"]]); // the find without a picture stays on the list
    expect(g.extras[0].id).toMatch(/^look-piece:/);
    expect(g.features).toEqual(["top"]); // a store top styles like a top (tuck, buttons…)
    const key = (await db.lookPiece.findFirstOrThrow({ where: { lookId: look.lookId, title: "Store find 4" } })).imageKey!;
    expect(key).toMatch(new RegExp(`^looks/${mya.id}/`));
    expect(await objectExists(key)).toBe(true);
    expect((await lookGarments(look.lookId)).extras[0].id).toBe(g.extras[0].id); // the second time reads the bucket
    const first = await mannequinLook(jeff, mya.id, g.itemIds, "look", g.extras, undefined, undefined, g.features);
    expect(first).toMatchObject({ cached: false, mannequin: true });
    expect(first.itemIds).toEqual([`extra:${g.extras[0].id}`, myaJeans.id].sort());
    expect((await mannequinLook(jeff, mya.id, g.itemIds, "look", g.extras, undefined, undefined, g.features)).cached).toBe(true);

    // Jeff (an adult with a body photo): on him, through the engine rule, the store find included
    const bodyKey = newKey("bodies", jeff.id, "image/jpeg");
    await putObject(bodyKey, await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 120, g: 110, b: 100 } } }).jpeg().toBuffer(), "image/jpeg");
    await addBodyPhoto(jeff, jeff.id, bodyKey, { view: "front" });
    const jeans = await piece(jeff, "Dark jeans", bottoms);
    const mine = await addToLook(jeff, jeff.id, find(5, { category: "Tops" }));
    await addPieces(jeff, mine.lookId, [{ itemId: jeans.id }]);
    const mg = await lookGarments(mine.lookId);
    const onMe = await dressOnMe(jeff, jeff.id, mg.itemIds, "look", "front", undefined, false, {}, mg.extras, mg.features);
    expect(onMe.cached).toBe(false);
    expect(onMe.itemIds).toEqual([`extra:${mg.extras[0].id}`, jeans.id].sort());
    expect((await tryOnLook(jeff, jeff.id, mg.itemIds, "look", mg.extras)).cached).toBe(true);
    // the Shop's single candidate picture still works the old way
    const shop = await tryOnLook(jeff, jeff.id, [jeans.id], "shop:abc", mg.extras[0].buf);
    expect(shop.itemIds).toEqual(["extra:shop:abc", jeans.id].sort());
  });
});

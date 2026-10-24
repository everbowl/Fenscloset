import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { personalClosetId } from "@/lib/items/service";
import { mirrorWardrobe } from "@/lib/tryon/wardrobe";

async function add(ownerId: string, name: string, category: string, extra: { isFavorite?: boolean; lastWornAt?: Date; retiredAt?: Date; createdAt?: Date; thumb?: string } = {}) {
  const cat = await db.category.findFirstOrThrow({ where: { name: category } });
  return db.item.create({ data: { ownerId, name, categoryId: cat.id, isFavorite: extra.isFavorite ?? false, lastWornAt: extra.lastWornAt, retiredAt: extra.retiredAt, createdAt: extra.createdAt, closets: { create: [{ closetId: await personalClosetId(ownerId) }] }, ...(extra.thumb ? { photos: { create: [{ kind: "thumb", bucketKey: extra.thumb }] } } : {}) } });
}

describe("the mirror's wardrobe", () => {
  beforeEach(async () => { await resetDb(); process.env.MOCK_S3 = "true"; await seed(); });

  it("lists the placeable pieces favorites first, then recently worn, then newest, with thumbs; leaves out retired pieces and what the mirror can't place; knows what the Shop put together", async () => {
    const jeff = await db.person.findFirstOrThrow({ where: { name: "Jeff" } });
    const old = new Date(Date.now() - 30 * 86400_000);
    const tee = await add(jeff.id, "White tee", "Tops", { createdAt: old, thumb: "thumbs/tee.jpg" });
    const jeans = await add(jeff.id, "Dark jeans", "Bottoms", { createdAt: old, lastWornAt: new Date() });
    const boots = await add(jeff.id, "Boots", "Shoes", { isFavorite: true, createdAt: old });
    const newTee = await add(jeff.id, "New tee", "Tops");
    await add(jeff.id, "Old parka", "Outerwear", { retiredAt: new Date() });
    await add(jeff.id, "Cap", "Hats");
    await db.goWith.create({ data: { itemId: tee.id, forPersonId: jeff.id, askedById: jeff.id, reason: "r", closetLooks: [{ itemIds: [tee.id, jeans.id, boots.id], reason: "a" }] as object[] } });
    const w = await mirrorWardrobe(jeff.id);
    expect(w.pieces.map((p) => p.name)).toEqual(["Boots", "Dark jeans", "New tee", "White tee"]);
    expect(w.pieces.find((p) => p.name === "White tee")).toMatchObject({ thumbKey: "thumbs/tee.jpg", category: "Tops", isFavorite: false });
    expect(w.goesWith[tee.id]!.sort()).toEqual([boots.id, jeans.id].sort());
    expect(w.goesWith[jeans.id]!.sort()).toEqual([boots.id, tee.id].sort());
    expect(w.goesWith[newTee.id]).toBeUndefined();
    // someone else's closet is not this wardrobe
    const olivia = await db.person.findFirstOrThrow({ where: { name: "Olivia" } });
    expect((await mirrorWardrobe(olivia.id)).pieces).toEqual([]);
  });
});

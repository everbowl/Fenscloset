import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { canEditItem, canSeeWornPhoto, resolveView, viewableClosets } from "@/lib/people/visibility";
import { countClosetItems, listClosetItems, statusWord } from "@/lib/items/query";
import { cycleLaundry, personalClosetId, updateItem } from "@/lib/items/service";

describe("who sees what", () => {
  beforeEach(async () => { await resetDb(); process.env.DEV_MODE = "true"; await seed(); });

  async function people() {
    const by = async (name: string) => db.person.findFirstOrThrow({ where: { name } });
    return { jeff: await by("Jeff"), brittney: await by("Brittney"), olivia: await by("Olivia"), mya: await by("Mya") };
  }

  it("every family member can pick any closet plus Family; the cookie resolves safely", async () => {
    const { olivia, mya } = await people();
    const views = await viewableClosets(olivia);
    expect(views.map((v) => v.label)).toEqual(["Olivia", "Family", "Jeff", "Brittney", "Mya"]);
    expect(await resolveView(olivia, undefined)).toMatchObject({ kind: "person", personId: olivia.id, name: "Olivia" });
    expect(await resolveView(olivia, "family")).toEqual({ kind: "family" });
    expect(await resolveView(olivia, mya.id)).toMatchObject({ kind: "person", personId: mya.id });
    expect(await resolveView(olivia, "nope")).toMatchObject({ personId: olivia.id });
  });

  it("a minor's worn photos stay with the minor and parents; adults' are family-visible", async () => {
    const { jeff, olivia, mya } = await people();
    expect(await canSeeWornPhoto(olivia, mya)).toBe(false);
    expect(await canSeeWornPhoto(jeff, mya)).toBe(true);
    expect(await canSeeWornPhoto(mya, mya)).toBe(true);
    expect(await canSeeWornPhoto(mya, olivia)).toBe(true);
    expect(canEditItem(olivia, mya.id)).toBe(false);
    expect(canEditItem(jeff, mya.id)).toBe(true);
  });

  it("closet views list the right items, the Family closet spans people, search matches name or brand", async () => {
    const { jeff, olivia } = await people();
    const tops = await db.category.findFirstOrThrow({ where: { name: "Tops" } });
    const nike = await db.brand.findFirstOrThrow({ where: { name: "Nike" } });
    const family = await db.closet.findFirstOrThrow({ where: { kind: "family" } });
    const a = await db.item.create({ data: { ownerId: jeff.id, name: "Grey hoodie", categoryId: tops.id, brandId: nike.id, closets: { create: [{ closetId: await personalClosetId(jeff.id) }] } } });
    await db.item.create({ data: { ownerId: olivia.id, name: "Silk top", categoryId: tops.id, closets: { create: [{ closetId: await personalClosetId(olivia.id) }, { closetId: family.id }] } } });
    expect((await listClosetItems({ kind: "person", personId: jeff.id, name: "Jeff" })).map((i) => i.name)).toEqual(["Grey hoodie"]);
    expect((await listClosetItems({ kind: "family" })).map((i) => i.name)).toEqual(["Silk top"]);
    expect(await countClosetItems({ kind: "person", personId: olivia.id, name: "Olivia" })).toBe(1);
    expect((await listClosetItems({ kind: "person", personId: jeff.id, name: "Jeff" }, { q: "nike" })).length).toBe(1);
    expect((await listClosetItems({ kind: "person", personId: jeff.id, name: "Jeff" }, { q: "silk" })).length).toBe(0);
    // laundry words and the one-tap cycle
    expect(statusWord({ laundryStatus: "clean", wearCount: 0 })).toBe("New");
    expect(statusWord({ laundryStatus: "clean", wearCount: 4 })).toBe("Worn 4×");
    expect(await cycleLaundry(jeff, a.id)).toBe("dirty");
    expect((await listClosetItems({ kind: "person", personId: jeff.id, name: "Jeff" }))[0].status).toBe("Laundry");
    expect(await cycleLaundry(jeff, a.id)).toBe("cleaners");
    expect(await cycleLaundry(jeff, a.id)).toBe("clean");
    await expect(cycleLaundry(olivia, a.id)).rejects.toMatchObject({ status: 403 });
    // Family closet + sharing through updateItem
    await updateItem(jeff, a.id, { closetIds: [family.id], sharedWithIds: [olivia.id, jeff.id], purchasePrice: "$48.50", fitNotes: " runs small " });
    const full = await db.item.findUniqueOrThrow({ where: { id: a.id }, include: { closets: { include: { closet: true } }, shares: true } });
    expect(full.closets.map((c) => c.closet.kind).sort()).toEqual(["family", "personal"]);
    expect(full.shares.map((s) => s.personId)).toEqual([olivia.id]);
    expect(String(full.purchasePrice)).toBe("48.5");
    expect(full.fitNotes).toBe("runs small");
    await updateItem(jeff, a.id, { closetIds: [] });
    expect((await db.itemCloset.findMany({ where: { itemId: a.id } })).length).toBe(1);
    await expect(updateItem(jeff, a.id, { purchasePrice: "lots" })).rejects.toThrow(/price/);
  });
});

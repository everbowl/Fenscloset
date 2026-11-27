import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { canEditItem, canSeeWornPhoto, resolveView, viewableClosets } from "@/lib/people/visibility";
import { countClosetItems, listClosetItems, statusWord } from "@/lib/items/query";
import { cycleLaundry, personalClosetId, updateItem } from "@/lib/items/service";

describe("who sees what", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  async function people() {
    const by = async (name: string) => db.person.findFirstOrThrow({ where: { name } });
    return { avery: await by("Avery"), blake: await by("Blake"), casey: await by("Casey"), devon: await by("Devon") };
  }

  it("every family member can pick any closet plus Family; the cookie resolves safely", async () => {
    const { casey, devon } = await people();
    const views = await viewableClosets(casey);
    expect(views.map((v) => v.label)).toEqual(["Casey", "Family", "Avery", "Blake", "Devon"]);
    expect(await resolveView(casey, undefined)).toMatchObject({ kind: "person", personId: casey.id, name: "Casey" });
    expect(await resolveView(casey, "family")).toEqual({ kind: "family" });
    expect(await resolveView(casey, devon.id)).toMatchObject({ kind: "person", personId: devon.id });
    expect(await resolveView(casey, "nope")).toMatchObject({ personId: casey.id });
  });

  it("a minor's worn photos stay with the minor and parents; adults' are family-visible", async () => {
    const { avery, casey, devon } = await people();
    expect(await canSeeWornPhoto(casey, devon)).toBe(false);
    expect(await canSeeWornPhoto(avery, devon)).toBe(true);
    expect(await canSeeWornPhoto(devon, devon)).toBe(true);
    expect(await canSeeWornPhoto(devon, casey)).toBe(true);
    expect(canEditItem(casey, devon.id)).toBe(false);
    expect(canEditItem(avery, devon.id)).toBe(true);
  });

  it("closet views list the right items, the Family closet spans people, search matches name or brand", async () => {
    const { avery, casey } = await people();
    const tops = await db.category.findFirstOrThrow({ where: { name: "Tops" } });
    const nike = await db.brand.findFirstOrThrow({ where: { name: "Nike" } });
    const family = await db.closet.findFirstOrThrow({ where: { kind: "family" } });
    const a = await db.item.create({ data: { ownerId: avery.id, name: "Grey hoodie", categoryId: tops.id, brandId: nike.id, closets: { create: [{ closetId: await personalClosetId(avery.id) }] } } });
    await db.item.create({ data: { ownerId: casey.id, name: "Silk top", categoryId: tops.id, closets: { create: [{ closetId: await personalClosetId(casey.id) }, { closetId: family.id }] } } });
    expect((await listClosetItems({ kind: "person", personId: avery.id, name: "Avery" })).map((i) => i.name)).toEqual(["Grey hoodie"]);
    expect((await listClosetItems({ kind: "family" })).map((i) => i.name)).toEqual(["Silk top"]);
    expect(await countClosetItems({ kind: "person", personId: casey.id, name: "Casey" })).toBe(1);
    expect((await listClosetItems({ kind: "person", personId: avery.id, name: "Avery" }, { q: "nike" })).length).toBe(1);
    expect((await listClosetItems({ kind: "person", personId: avery.id, name: "Avery" }, { q: "silk" })).length).toBe(0);
    // laundry words and the one-tap cycle
    expect(statusWord({ laundryStatus: "clean", wearCount: 0 })).toBe("New");
    expect(statusWord({ laundryStatus: "clean", wearCount: 4 })).toBe("Worn 4×");
    expect(await cycleLaundry(avery, a.id)).toBe("dirty");
    expect((await listClosetItems({ kind: "person", personId: avery.id, name: "Avery" }))[0].status).toBe("In the wash");
    expect(await cycleLaundry(avery, a.id)).toBe("cleaners");
    expect(await cycleLaundry(avery, a.id)).toBe("clean");
    await expect(cycleLaundry(casey, a.id)).rejects.toMatchObject({ status: 403 });
    // Family closet + sharing through updateItem
    await updateItem(avery, a.id, { closetIds: [family.id], sharedWithIds: [casey.id, avery.id], purchasePrice: "$48.50", fitNotes: " runs small " });
    const full = await db.item.findUniqueOrThrow({ where: { id: a.id }, include: { closets: { include: { closet: true } }, shares: true } });
    expect(full.closets.map((c) => c.closet.kind).sort()).toEqual(["family", "personal"]);
    expect(full.shares.map((s) => s.personId)).toEqual([casey.id]);
    expect(String(full.purchasePrice)).toBe("48.5");
    expect(full.fitNotes).toBe("runs small");
    await updateItem(avery, a.id, { closetIds: [] });
    expect((await db.itemCloset.findMany({ where: { itemId: a.id } })).length).toBe(1);
    await expect(updateItem(avery, a.id, { purchasePrice: "lots" })).rejects.toThrow(/price/);
  });
});

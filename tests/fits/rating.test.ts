import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { personalClosetId } from "@/lib/items/service";
import { getDay, rateFit, saveFit, unratedRecentFit } from "@/lib/fits/service";
import { forgetTaste, tasteLines } from "@/lib/outfits/taste";

async function addItem(ownerId: string, name: string, category: string) {
  const cat = await db.category.findFirstOrThrow({ where: { name: category } });
  return db.item.create({ data: { ownerId, name, categoryId: cat.id, closets: { create: [{ closetId: await personalClosetId(ownerId) }] } } });
}

describe("how did it go?", () => {
  beforeEach(async () => { await resetDb(); process.env.MOCK_AI = "true"; await seed(); });

  it("rates a fit, feeds taste memory, shows on Today until answered, and can be forgotten", async () => {
    const [jeff, olivia] = await Promise.all([db.person.findFirstOrThrow({ where: { name: "Jeff" } }), db.person.findFirstOrThrow({ where: { name: "Olivia" } })]);
    const tee = await addItem(jeff.id, "White tee", "Tops"); const jeans = await addItem(jeff.id, "Dark jeans", "Bottoms");
    const fitId = await saveFit(jeff, jeff.id, "2026-10-17", [tee.id, jeans.id], "Dinner");
    expect(await unratedRecentFit(jeff.id, "2026-10-18")).toMatchObject({ id: fitId, date: "2026-10-17", title: "Dinner" });
    expect(await unratedRecentFit(jeff.id, "2026-10-17")).toBeNull(); // same day is not "yesterday"
    expect(await unratedRecentFit(jeff.id, "2026-10-30")).toBeNull(); // older than a week: stop nagging
    await expect(rateFit(olivia, fitId, "loved")).rejects.toMatchObject({ status: 403 });
    await rateFit(jeff, fitId, "loved");
    expect((await getDay(jeff, { kind: "person", personId: jeff.id, name: "Jeff" }, "2026-10-17"))[0].rating).toBe("loved");
    expect(await unratedRecentFit(jeff.id, "2026-10-18")).toBeNull();
    const lines = await tasteLines(jeff.id, new Date("2026-10-18T12:00:00Z"));
    expect(lines.map((l) => l.text)).toContain("Loved wearing White tee + Dark jeans");
    await rateFit(jeff, fitId, "never_again");
    expect((await tasteLines(jeff.id, new Date("2026-10-18T12:00:00Z"))).map((l) => l.text)).toContain("Never again: White tee + Dark jeans");
    await forgetTaste(jeff.id, tee.id);
    expect((await getDay(jeff, { kind: "person", personId: jeff.id, name: "Jeff" }, "2026-10-17"))[0].rating).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { personalClosetId } from "@/lib/items/service";
import { generateSuggestion, moreLooks, swapPiece, wearBoard, type DayContext } from "@/lib/outfits/engine";
import { styleContext } from "@/lib/outfits/catalog";
import { forgetTaste, tasteContext, tasteLines } from "@/lib/outfits/taste";
import { setRule } from "@/lib/rules";

const ctx: DayContext = { weather: null, plan: { source: "none", occasionId: null, label: null }, checkIn: null };

async function addItem(ownerId: string, name: string, category: string) {
  const cat = await db.category.findFirstOrThrow({ where: { name: category } });
  return db.item.create({ data: { ownerId, name, categoryId: cat.id, closets: { create: [{ closetId: await personalClosetId(ownerId) }] } } });
}

describe("taste memory", () => {
  beforeEach(async () => { await resetDb(); process.env.MOCK_AI = "true"; await seed(); await setRule("noRepeatDays", "0"); /* so the same pieces are offered every day */ });

  it("learns from WEAR THIS, passes, swaps; feeds the style context; can be forgotten", async () => {
    const avery = await db.person.findFirstOrThrow({ where: { name: "Avery" } });
    const tee = await addItem(avery.id, "White tee", "Tops"); await addItem(avery.id, "Blue oxford", "Tops"); await addItem(avery.id, "Black polo", "Tops");
    const jeans = await addItem(avery.id, "Dark jeans", "Bottoms"); await addItem(avery.id, "Chinos", "Bottoms"); await addItem(avery.id, "Shorts", "Bottoms");
    await addItem(avery.id, "Sneakers", "Shoes"); await addItem(avery.id, "Loafers", "Shoes"); await addItem(avery.id, "Boots", "Shoes");
    expect(await tasteContext(avery.id)).toBe("");
    for (const day of ["2026-10-10", "2026-10-11", "2026-10-12"]) {
      const s = await generateSuggestion(avery.id, day, ctx);
      await wearBoard(avery, avery.id, s.id, 0, "Look", new Date(`${day}T12:00:00Z`));
    }
    // mock look 1 is always the first piece of each category: tee + jeans + sneakers → worn 3×, pairs 3×; looks 2 and 3 passed 3×
    const lines = await tasteLines(avery.id, new Date("2026-10-13T00:00:00Z"));
    expect(lines.find((l) => l.key === `worn:${tee.id}`)?.text).toBe("Reaches for White tee (worn 3× when offered)");
    expect(lines.some((l) => l.key.startsWith("pair:") && l.text.includes("Dark jeans") && l.text.includes("White tee"))).toBe(true);
    expect(lines.some((l) => l.text.startsWith("Passed on looks with Blue oxford 3 times"))).toBe(true);
    // wearing a second look the same day replaces the first worn record
    const again = await generateSuggestion(avery.id, "2026-10-12", ctx);
    await wearBoard(avery, avery.id, again.id, 1, "Changed my mind", new Date("2026-10-12T18:00:00Z"));
    expect(await db.lookFeedback.count({ where: { personId: avery.id, date: "2026-10-12", kind: "worn" } })).toBe(1);
    // MORE LOOKS marks the shown looks as passed; a swap records out/in
    const s4 = await generateSuggestion(avery.id, "2026-10-14", ctx);
    await moreLooks(avery.id, "2026-10-14", ctx);
    expect(await db.lookFeedback.count({ where: { personId: avery.id, date: "2026-10-14", kind: "passed" } })).toBe(3);
    await swapPiece(avery.id, "2026-10-14", 0, jeans.id, ctx);
    await swapPiece(avery.id, "2026-10-15", 0, jeans.id, { ...ctx }).catch(() => {});
    expect(await db.lookFeedback.count({ where: { personId: avery.id, kind: "swapped_out", itemId: jeans.id } })).toBeGreaterThanOrEqual(1);
    expect(s4.boards.length).toBe(3);
    // the prompt context carries the taste block, after the style words
    const style = await styleContext(avery.id);
    expect(style).toContain("Taste memory");
    expect(style).toContain("Reaches for White tee");
    // forget one piece, then everything
    await forgetTaste(avery.id, tee.id);
    expect((await tasteLines(avery.id, new Date("2026-10-16T00:00:00Z"))).some((l) => l.itemIds.includes(tee.id))).toBe(false);
    await forgetTaste(avery.id);
    expect(await db.lookFeedback.count({ where: { personId: avery.id } })).toBe(0);
    expect(await tasteContext(avery.id)).toBe("");
  });
});

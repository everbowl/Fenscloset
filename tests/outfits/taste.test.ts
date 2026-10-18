import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
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
    const jeff = await db.person.findFirstOrThrow({ where: { name: "Jeff" } });
    const tee = await addItem(jeff.id, "White tee", "Tops"); await addItem(jeff.id, "Blue oxford", "Tops"); await addItem(jeff.id, "Black polo", "Tops");
    const jeans = await addItem(jeff.id, "Dark jeans", "Bottoms"); await addItem(jeff.id, "Chinos", "Bottoms"); await addItem(jeff.id, "Shorts", "Bottoms");
    await addItem(jeff.id, "Sneakers", "Shoes"); await addItem(jeff.id, "Loafers", "Shoes"); await addItem(jeff.id, "Boots", "Shoes");
    expect(await tasteContext(jeff.id)).toBe("");
    for (const day of ["2026-10-10", "2026-10-11", "2026-10-12"]) {
      const s = await generateSuggestion(jeff.id, day, ctx);
      await wearBoard(jeff, jeff.id, s.id, 0, "Look", new Date(`${day}T12:00:00Z`));
    }
    // mock look 1 is always the first piece of each category: tee + jeans + sneakers → worn 3×, pairs 3×; looks 2 and 3 passed 3×
    const lines = await tasteLines(jeff.id, new Date("2026-10-13T00:00:00Z"));
    expect(lines.find((l) => l.key === `worn:${tee.id}`)?.text).toBe("Reaches for White tee (worn 3× when offered)");
    expect(lines.some((l) => l.key.startsWith("pair:") && l.text.includes("Dark jeans") && l.text.includes("White tee"))).toBe(true);
    expect(lines.some((l) => l.text.startsWith("Passed on looks with Blue oxford 3 times"))).toBe(true);
    // wearing a second look the same day replaces the first worn record
    const again = await generateSuggestion(jeff.id, "2026-10-12", ctx);
    await wearBoard(jeff, jeff.id, again.id, 1, "Changed my mind", new Date("2026-10-12T18:00:00Z"));
    expect(await db.lookFeedback.count({ where: { personId: jeff.id, date: "2026-10-12", kind: "worn" } })).toBe(1);
    // MORE LOOKS marks the shown looks as passed; a swap records out/in
    const s4 = await generateSuggestion(jeff.id, "2026-10-14", ctx);
    await moreLooks(jeff.id, "2026-10-14", ctx);
    expect(await db.lookFeedback.count({ where: { personId: jeff.id, date: "2026-10-14", kind: "passed" } })).toBe(3);
    await swapPiece(jeff.id, "2026-10-14", 0, jeans.id, ctx);
    await swapPiece(jeff.id, "2026-10-15", 0, jeans.id, { ...ctx }).catch(() => {});
    expect(await db.lookFeedback.count({ where: { personId: jeff.id, kind: "swapped_out", itemId: jeans.id } })).toBeGreaterThanOrEqual(1);
    expect(s4.boards.length).toBe(3);
    // the prompt context carries the taste block, after the style words
    const style = await styleContext(jeff.id);
    expect(style).toContain("Taste memory");
    expect(style).toContain("Reaches for White tee");
    // forget one piece, then everything
    await forgetTaste(jeff.id, tee.id);
    expect((await tasteLines(jeff.id, new Date("2026-10-16T00:00:00Z"))).some((l) => l.itemIds.includes(tee.id))).toBe(false);
    await forgetTaste(jeff.id);
    expect(await db.lookFeedback.count({ where: { personId: jeff.id } })).toBe(0);
    expect(await tasteContext(jeff.id)).toBe("");
  });
});

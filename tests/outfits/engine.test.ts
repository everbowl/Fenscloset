import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { personalClosetId } from "@/lib/items/service";
import { loadCandidates } from "@/lib/outfits/catalog";
import { generateSuggestion, getOrGenerate, moreLooks, swapPiece, wearBoard, type DayContext } from "@/lib/outfits/engine";
import { cleanOutDecision, listCleanOut } from "@/lib/outfits/cleanout";
import { createTogether, togetherPeople } from "@/lib/outfits/together";

const ctx: DayContext = { weather: { nowF: 68, tonightF: 61, highF: 71, lowF: 58, rainChance: 0, condition: "Clear", timezone: "America/Los_Angeles", source: "mock" }, plan: { source: "none", occasionId: null, label: null }, checkIn: null };
const DAY = "2026-10-18";

async function addItem(ownerId: string, name: string, category: string, extra: Partial<{ laundryStatus: "dirty" | "clean" | "cleaners"; neverSuggest: boolean; lastWornAt: Date; createdAt: Date }> = {}) {
  const cat = await db.category.findFirstOrThrow({ where: { name: category } });
  const closetId = await personalClosetId(ownerId);
  return db.item.create({ data: { ownerId, name, categoryId: cat.id, closets: { create: [{ closetId }] }, ...extra } });
}

describe("outfit engine", () => {
  beforeEach(async () => { await resetDb(); process.env.MOCK_AI = "true"; await seed(); });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });

  it("filters laundry, never-suggest, retired and recently worn; builds 3 looks; wear logs and fits; swap; more", async () => {
    const [jeff, olivia] = await Promise.all([by("Jeff"), by("Olivia")]);
    const tee = await addItem(jeff.id, "White tee", "Tops");
    const dirty = await addItem(jeff.id, "Dirty shirt", "Tops", { laundryStatus: "dirty" });
    const never = await addItem(jeff.id, "Old jeans", "Bottoms", { neverSuggest: true });
    const jeans = await addItem(jeff.id, "Dark jeans", "Bottoms");
    const recent = await addItem(jeff.id, "Boots", "Shoes", { lastWornAt: new Date(Date.now() - 2 * 86400000) });
    const sneakers = await addItem(jeff.id, "Sneakers", "Shoes");
    const loafers = await addItem(jeff.id, "Loafers", "Shoes");
    const blazer = await addItem(jeff.id, "Linen blazer", "Outerwear");
    const cand = await loadCandidates(jeff.id);
    expect(cand.usable.map((c) => c.id).sort()).toEqual([tee.id, jeans.id, sneakers.id, loafers.id, blazer.id].sort());
    expect(cand.restingIds).toEqual([recent.id]);
    for (const bad of [dirty.id, never.id]) expect(cand.usable.some((c) => c.id === bad)).toBe(false);

    const s = await generateSuggestion(jeff.id, DAY, ctx);
    expect(s.boards).toHaveLength(3);
    for (const b of s.boards) { expect(b.pieces.length).toBeGreaterThanOrEqual(2); expect(b.itemIds).not.toContain(dirty.id); expect(b.itemIds).not.toContain(recent.id); }
    expect((await getOrGenerate(jeff.id, DAY, ctx)).id).toBe(s.id);

    await expect(wearBoard(olivia, jeff.id, s.id, 0, "Today")).rejects.toMatchObject({ status: 403 });
    const fitId = await wearBoard(jeff, jeff.id, s.id, 0, "Dinner out");
    const fit = await db.fit.findUniqueOrThrow({ where: { id: fitId }, include: { items: true, wearLogs: true } });
    expect(fit.items.map((i) => i.itemId).sort()).toEqual([...s.boards[0].itemIds].sort());
    expect(fit.wearLogs).toHaveLength(s.boards[0].itemIds.length);
    expect((await db.item.findUniqueOrThrow({ where: { id: tee.id } })).wearCount).toBe(1);
    // wearing again the same day replaces the fit instead of double counting
    const fitId2 = await wearBoard(jeff, jeff.id, s.id, 1, "Dinner out");
    expect(fitId2).toBe(fitId);
    expect((await db.item.findUniqueOrThrow({ where: { id: tee.id } })).wearCount).toBe(1);
    expect(await db.fit.count({ where: { personId: jeff.id, date: DAY } })).toBe(1);
    expect((await getOrGenerate(jeff.id, DAY, ctx)).wornIndex).toBe(1);

    const tee2 = await addItem(jeff.id, "Black tee", "Tops");
    const swapped = await swapPiece(jeff.id, DAY, 2, tee.id, ctx);
    expect(swapped.boards[2].itemIds).toContain(tee2.id);
    expect(swapped.boards[2].itemIds).not.toContain(tee.id);
    await expect(swapPiece(jeff.id, DAY, 2, blazer.id, ctx)).rejects.toMatchObject({ status: 400 }); // nothing else in Outerwear

    // replacing the day's fit also un-sets lastWornAt on the pieces that came off it
    expect((await db.item.findUniqueOrThrow({ where: { id: sneakers.id } })).lastWornAt).toBeNull();
    // worn today is not "resting": the pieces you have on may still be suggested today
    expect((await loadCandidates(jeff.id)).usable.map((c) => c.id)).toContain(tee.id);
    const more = await moreLooks(jeff.id, DAY, ctx);
    expect(more.boards).toHaveLength(6);
  });

  it("falls back to resting pieces when the closet is small, and says so", async () => {
    const jeff = await by("Jeff");
    await addItem(jeff.id, "Tee", "Tops", { lastWornAt: new Date(Date.now() - 86400000) });
    await addItem(jeff.id, "Jeans", "Bottoms", { lastWornAt: new Date(Date.now() - 86400000) });
    const s = await generateSuggestion(jeff.id, DAY, ctx);
    expect(s.boards.length).toBeGreaterThan(0);
    expect(s.boards[0].reason).toContain("Repeats a recent piece");
  });

  it("clean-out lists pieces not worn for the rule's months; keep snoozes, donate retires and removes from suggestions", async () => {
    const [jeff, olivia] = await Promise.all([by("Jeff"), by("Olivia")]);
    const old = await addItem(jeff.id, "Old coat", "Outerwear", { createdAt: new Date(Date.now() - 400 * 86400000) });
    const stale = await addItem(jeff.id, "Stale shoes", "Shoes", { createdAt: new Date(Date.now() - 400 * 86400000), lastWornAt: new Date(Date.now() - 300 * 86400000) });
    await addItem(jeff.id, "Fresh tee", "Tops");
    const list = await listCleanOut(jeff.id);
    expect(list.months).toBe(6);
    expect(list.items.map((i) => i.id).sort()).toEqual([old.id, stale.id].sort());
    await expect(cleanOutDecision(olivia, old.id, "keep")).rejects.toMatchObject({ status: 403 });
    await cleanOutDecision(jeff, old.id, "keep");
    await cleanOutDecision(jeff, stale.id, "donate");
    expect((await listCleanOut(jeff.id)).items).toEqual([]);
    const cand = await loadCandidates(jeff.id);
    expect(cand.usable.some((c) => c.id === stale.id)).toBe(false);
    expect((await db.item.findUniqueOrThrow({ where: { id: stale.id } })).retiredReason).toBe("donate");
  });

  it("together: one look per person, minors only with their parents", async () => {
    const [jeff, brittney, olivia, mya] = await Promise.all([by("Jeff"), by("Brittney"), by("Olivia"), by("Mya")]);
    for (const p of [jeff, brittney, olivia, mya]) { await addItem(p.id, `${p.name} top`, "Tops"); await addItem(p.id, `${p.name} jeans`, "Bottoms"); }
    expect((await togetherPeople(olivia)).map((p) => p.name)).toEqual(["Jeff", "Brittney", "Olivia"]);
    expect((await togetherPeople(jeff)).map((p) => p.name)).toContain("Mya");
    const t = await createTogether(jeff, { personIds: [jeff.id, brittney.id, olivia.id], mode: "match", date: DAY, ctx });
    expect(t.boards).toHaveLength(3);
    expect(t.boards.map((b) => b.personName)).toEqual(["Jeff", "Brittney", "Olivia"]);
    for (const b of t.boards) expect(b.pieces.every((p) => p.ownerId === b.personId)).toBe(true);
    await expect(createTogether(olivia, { personIds: [olivia.id, mya.id], mode: "match", date: DAY, ctx })).rejects.toMatchObject({ status: 400 });
    const fitId = await wearBoard(jeff, mya.id, (await createTogether(jeff, { personIds: [jeff.id, mya.id], mode: "coordinate", date: DAY, ctx })).boards[1].suggestionId, 0, "Coordinated");
    expect(fitId).toBeTruthy();
  });
});

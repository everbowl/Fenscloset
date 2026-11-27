import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { personalClosetId } from "@/lib/items/service";
import { loadCandidates } from "@/lib/outfits/catalog";
import { FIRST_LOOK_READY, generateSuggestion, getOrGenerate, getSuggestion, moreLooks, removePiece, swapPiece, wearBoard, type DayContext } from "@/lib/outfits/engine";
import { cleanOutDecision, listCleanOut } from "@/lib/outfits/cleanout";
import { createTogether, togetherPeople } from "@/lib/outfits/together";
import { dayKey, hourIn } from "@/lib/dates";

const ctx: DayContext = { weather: { nowF: 68, tonightF: 61, highF: 71, lowF: 58, rainChance: 0, condition: "Clear", timezone: "America/Los_Angeles", source: "mock" }, plan: { source: "none", occasionId: null, label: null }, checkIn: null };
const DAY = "2026-10-18";
/** Noon in Los Angeles on DAY: Wear this checks that the looks are today's (review D 2.8). */
const NOW = new Date("2026-10-18T19:00:00Z");
const TZ = "America/Los_Angeles";

async function addItem(ownerId: string, name: string, category: string, extra: Partial<{ laundryStatus: "dirty" | "clean" | "cleaners"; neverSuggest: boolean; lastWornAt: Date; createdAt: Date }> = {}) {
  const cat = await db.category.findFirstOrThrow({ where: { name: category } });
  const closetId = await personalClosetId(ownerId);
  return db.item.create({ data: { ownerId, name, categoryId: cat.id, closets: { create: [{ closetId }] }, ...extra } });
}

describe("outfit engine", () => {
  beforeEach(async () => { await resetDb(); process.env.MOCK_AI = "true"; await seed(); });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });

  it("filters laundry, never-suggest, retired and recently worn; builds 3 looks; wear logs and fits; swap; more", async () => {
    const [avery, casey] = await Promise.all([by("Avery"), by("Casey")]);
    const tee = await addItem(avery.id, "White tee", "Tops");
    const dirty = await addItem(avery.id, "Dirty shirt", "Tops", { laundryStatus: "dirty" });
    const never = await addItem(avery.id, "Old jeans", "Bottoms", { neverSuggest: true });
    const jeans = await addItem(avery.id, "Dark jeans", "Bottoms");
    const recent = await addItem(avery.id, "Boots", "Shoes", { lastWornAt: new Date(Date.now() - 2 * 86400000) });
    const sneakers = await addItem(avery.id, "Sneakers", "Shoes");
    const loafers = await addItem(avery.id, "Loafers", "Shoes");
    const blazer = await addItem(avery.id, "Linen blazer", "Outerwear");
    const cand = await loadCandidates(avery.id);
    expect(cand.usable.map((c) => c.id).sort()).toEqual([tee.id, jeans.id, sneakers.id, loafers.id, blazer.id].sort());
    expect(cand.restingIds).toEqual([recent.id]);
    for (const bad of [dirty.id, never.id]) expect(cand.usable.some((c) => c.id === bad)).toBe(false);

    const s = await generateSuggestion(avery.id, DAY, ctx);
    expect(s.boards).toHaveLength(3);
    for (const b of s.boards) { expect(b.pieces.length).toBeGreaterThanOrEqual(2); expect(b.itemIds).not.toContain(dirty.id); expect(b.itemIds).not.toContain(recent.id); }
    expect((await getOrGenerate(avery.id, DAY, ctx)).id).toBe(s.id);

    await expect(wearBoard(casey, avery.id, s.id, 0, "Today", NOW)).rejects.toMatchObject({ status: 403 });
    // looks from another day cannot be worn as today's (a Today left open past midnight; review D 2.8)
    await expect(wearBoard(avery, avery.id, s.id, 0, "Dinner out", new Date("2026-10-19T19:00:00Z"))).rejects.toThrow(/another day/);
    const fitId = await wearBoard(avery, avery.id, s.id, 0, "Dinner out", NOW);
    const fit = await db.fit.findUniqueOrThrow({ where: { id: fitId }, include: { items: true, wearLogs: true } });
    expect(fit.items.map((i) => i.itemId).sort()).toEqual([...s.boards[0].itemIds].sort());
    expect(fit.wearLogs).toHaveLength(s.boards[0].itemIds.length);
    expect((await db.item.findUniqueOrThrow({ where: { id: tee.id } })).wearCount).toBe(1);
    expect((await db.item.findUniqueOrThrow({ where: { id: tee.id } })).lastWornAt).toEqual(NOW); // worn today: the moment itself
    // with no title, the look's plan names the fit, else the time of day
    expect(fit.title).toBe("Dinner out");
    // wearing again the same day replaces the fit instead of double counting
    const fitId2 = await wearBoard(avery, avery.id, s.id, 1, null, NOW);
    expect(fitId2).toBe(fitId);
    expect((await db.fit.findUniqueOrThrow({ where: { id: fitId } })).title).toBe("Today’s look");
    expect((await db.item.findUniqueOrThrow({ where: { id: tee.id } })).wearCount).toBe(1);
    expect(await db.fit.count({ where: { personId: avery.id, date: DAY } })).toBe(1);
    expect((await getOrGenerate(avery.id, DAY, ctx)).wornIndex).toBe(1);
    // "Wearing this" survives a rebuild (a check-in or plan change makes a new row): the fit is matched by the day, not the row (review D 2.2)
    const rebuilt = await generateSuggestion(avery.id, DAY, ctx);
    expect(rebuilt.id).not.toBe(s.id);
    expect(rebuilt.wornIndex).toBe(1);
    expect((await getSuggestion(avery.id, DAY))!.boards[1].wornFitId).toBe(fitId);

    const tee2 = await addItem(avery.id, "Black tee", "Tops");
    const swapped = await swapPiece(avery.id, DAY, 2, tee.id, ctx);
    expect(swapped.boards[2].itemIds).toContain(tee2.id);
    expect(swapped.boards[2].itemIds).not.toContain(tee.id);
    await expect(swapPiece(avery.id, DAY, 2, blazer.id, ctx)).rejects.toMatchObject({ status: 400 }); // nothing else in Outerwear

    // replacing the day's fit also un-sets lastWornAt on the pieces that came off it
    expect((await db.item.findUniqueOrThrow({ where: { id: sneakers.id } })).lastWornAt).toBeNull();
    // worn today is not "resting": the pieces you have on may still be suggested today
    expect((await loadCandidates(avery.id)).usable.map((c) => c.id)).toContain(tee.id);
    const more = await moreLooks(avery.id, DAY, ctx);
    expect(more.boards).toHaveLength(6);
  });

  it("REMOVE takes a piece off a look (never below two), rewrites the reason, and keeps the why bullets", async () => {
    const avery = await by("Avery");
    await addItem(avery.id, "White tee", "Tops"); await addItem(avery.id, "Dark jeans", "Bottoms"); await addItem(avery.id, "Sneakers", "Shoes"); await addItem(avery.id, "Linen blazer", "Outerwear");
    const s = await generateSuggestion(avery.id, DAY, ctx);
    expect(s.boards[0].why?.weather.length).toBeGreaterThan(0);
    const before = s.boards[0].itemIds;
    expect(before.length).toBeGreaterThanOrEqual(3);
    const after = await removePiece(avery.id, DAY, 0, before[0], ctx);
    expect(after.boards[0].itemIds).toEqual(before.slice(1));
    expect(after.boards[0].reason).toContain("Mock: without");
    expect(after.boards[0].why).toBeTruthy();
    expect(after.boards[1].itemIds).toEqual(s.boards[1].itemIds);
    await expect(removePiece(avery.id, DAY, 0, "nope", ctx)).rejects.toMatchObject({ status: 400 });
    let ids = after.boards[0].itemIds;
    while (ids.length > 2) ids = (await removePiece(avery.id, DAY, 0, ids[0], ctx)).boards[0].itemIds;
    await expect(removePiece(avery.id, DAY, 0, ids[0], ctx)).rejects.toThrow(/at least two/);
    const fb = await db.lookFeedback.findMany({ where: { personId: avery.id, kind: "swapped_out" } });
    expect(fb.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to resting pieces when the closet is small, and says so", async () => {
    const avery = await by("Avery");
    await addItem(avery.id, "Tee", "Tops", { lastWornAt: new Date(Date.now() - 86400000) });
    await addItem(avery.id, "Jeans", "Bottoms", { lastWornAt: new Date(Date.now() - 86400000) });
    const s = await generateSuggestion(avery.id, DAY, ctx);
    expect(s.boards.length).toBeGreaterThan(0);
    expect(s.boards[0].reason).toContain("Repeats a recent piece");
  });

  it("builds one look first and says so (the screen shows board 1 while two more build), then fills the day to three", async () => {
    const avery = await by("Avery");
    await addItem(avery.id, "White tee", "Tops"); await addItem(avery.id, "Dark jeans", "Bottoms"); await addItem(avery.id, "Sneakers", "Shoes");
    const steps: [string, boolean][] = [];
    const s = await generateSuggestion(avery.id, DAY, ctx, (step, opts) => steps.push([step, Boolean(opts?.partial)]));
    expect(s.boards).toHaveLength(3);
    expect(steps.map(([x]) => x)).toEqual(["Reading the closet…", "Drafting the first look…", FIRST_LOOK_READY, "Two more looks…"]);
    expect(steps.find(([x]) => x === FIRST_LOOK_READY)?.[1]).toBe(true); // the first look is saved when that step is reported
    expect(steps.filter(([, partial]) => partial)).toHaveLength(1);
    expect(await db.outfitSuggestion.count({ where: { personId: avery.id, date: DAY } })).toBe(1); // one row, created then filled in
  });

  it("a fit saved for a past day rests its pieces from that day (local noon), and undoing falls back to the earlier wear", async () => {
    const avery = await by("Avery");
    await addItem(avery.id, "Tee", "Tops"); await addItem(avery.id, "Jeans", "Bottoms"); await addItem(avery.id, "Boots", "Shoes");
    const past = await generateSuggestion(avery.id, "2026-10-10", ctx);
    await wearBoard(avery, avery.id, past.id, 0, "Back then", new Date("2026-10-10T19:00:00Z"));
    const later = await generateSuggestion(avery.id, "2026-10-14", ctx);
    // saved on the 18th for the 14th: the pieces rest from the 14th, not from today (review D 2.3)
    const fitId = await wearBoard(avery, avery.id, later.id, 0, "Backfilled", new Date("2026-10-14T19:00:00Z"));
    const tee = await db.item.findFirstOrThrow({ where: { ownerId: avery.id, name: "Tee" } });
    expect(dayKey(tee.lastWornAt!, TZ)).toBe("2026-10-14");
    expect(hourIn(tee.lastWornAt!, TZ)).toBe(12);
    // undo: the earlier wear's day, as local noon, never UTC midnight (which is the evening before in Los Angeles; review D 2.4)
    const { deleteFit } = await import("@/lib/fits/service");
    await deleteFit(avery, fitId, new Date("2026-10-18T19:00:00Z"));
    const again = await db.item.findUniqueOrThrow({ where: { id: tee.id } });
    expect(dayKey(again.lastWornAt!, TZ)).toBe("2026-10-10");
    expect(hourIn(again.lastWornAt!, TZ)).toBe(12);
    expect(again.wearCount).toBe(1);
  });

  it("clean-out lists pieces not worn for the rule's months; keep snoozes, donate retires and removes from suggestions", async () => {
    const [avery, casey] = await Promise.all([by("Avery"), by("Casey")]);
    const old = await addItem(avery.id, "Old coat", "Outerwear", { createdAt: new Date(Date.now() - 400 * 86400000) });
    const stale = await addItem(avery.id, "Stale shoes", "Shoes", { createdAt: new Date(Date.now() - 400 * 86400000), lastWornAt: new Date(Date.now() - 300 * 86400000) });
    await addItem(avery.id, "Fresh tee", "Tops");
    const list = await listCleanOut(avery.id);
    expect(list.months).toBe(6);
    expect(list.items.map((i) => i.id).sort()).toEqual([old.id, stale.id].sort());
    await expect(cleanOutDecision(casey, old.id, "keep")).rejects.toMatchObject({ status: 403 });
    await cleanOutDecision(avery, old.id, "keep");
    await cleanOutDecision(avery, stale.id, "donate");
    expect((await listCleanOut(avery.id)).items).toEqual([]);
    const cand = await loadCandidates(avery.id);
    expect(cand.usable.some((c) => c.id === stale.id)).toBe(false);
    expect((await db.item.findUniqueOrThrow({ where: { id: stale.id } })).retiredReason).toBe("donate");
  });

  it("together: one look per person, minors only with their parents", async () => {
    const [avery, blake, casey, devon] = await Promise.all([by("Avery"), by("Blake"), by("Casey"), by("Devon")]);
    for (const p of [avery, blake, casey, devon]) { await addItem(p.id, `${p.name} top`, "Tops"); await addItem(p.id, `${p.name} jeans`, "Bottoms"); }
    expect((await togetherPeople(casey)).map((p) => p.name)).toEqual(["Avery", "Blake", "Casey"]);
    expect((await togetherPeople(avery)).map((p) => p.name)).toContain("Devon");
    const steps: string[] = [];
    const t = await createTogether(avery, { personIds: [avery.id, blake.id, casey.id], mode: "match", date: DAY, ctx, step: (s) => steps.push(s) });
    expect(t.boards).toHaveLength(3);
    expect(t.missing).toEqual([]);
    expect(steps).toEqual(["Reading everyone’s closets…", "Matching the looks…", "Saving…"]);
    expect(t.boards.map((b) => b.personName)).toEqual(["Avery", "Blake", "Casey"]);
    for (const b of t.boards) expect(b.pieces.every((p) => p.ownerId === b.personId)).toBe(true);
    // the creator's own calendar is not everyone's plan: with nothing picked, the plan is nothing (review D 8.4)
    expect(t.occasionLabel).toBeNull();
    expect(((await db.outfitSuggestion.findFirstOrThrow({ where: { togetherSessionId: t.id, personId: blake.id } })).inputs as { plan: { source: string } }).plan.source).toBe("none");
    await expect(createTogether(casey, { personIds: [casey.id, devon.id], mode: "match", date: DAY, ctx })).rejects.toMatchObject({ status: 400 });
    const fitId = await wearBoard(avery, devon.id, (await createTogether(avery, { personIds: [avery.id, devon.id], mode: "coordinate", date: DAY, ctx })).boards[1].suggestionId, 0, "Coordinated", NOW);
    expect(fitId).toBeTruthy();
    // a person without enough clean pieces is a line with a reason, never silently missing (review D 8.2)
    const empty = await db.person.create({ data: { name: "Sam Empty", email: "sam@example.com", role: "member" } });
    const t2 = await createTogether(avery, { personIds: [avery.id, empty.id], mode: "coordinate", date: DAY, ctx });
    expect(t2.boards.map((b) => b.personName)).toEqual(["Avery"]);
    expect(t2.missing).toEqual([{ personId: empty.id, personName: "Sam", reason: "Not enough clean pieces for a look." }]);
  });
});

describe("visual ranking", () => {
  beforeEach(async () => { await resetDb(); process.env.MOCK_AI = "true"; await seed(); });

  it("keeps the text order when there are no photos to judge, and never returns more than asked", async () => {
    const { rankVisually } = await import("@/lib/outfits/engine");
    const avery = await db.person.findFirstOrThrow({ where: { name: "Avery" } });
    const cands = (await loadCandidates(avery.id)).usable;
    const boards = [{ itemIds: ["a", "b"], reason: "one" }, { itemIds: ["c", "d"], reason: "two" }, { itemIds: ["e", "f"], reason: "three" }];
    expect(await rankVisually(boards, cands, { weather: null, plan: { label: null, source: "none" }, checkIn: [], restingIds: [], noRepeatDays: 0 }, 2, "")).toEqual(boards.slice(0, 2));
    expect(await rankVisually(boards.slice(0, 2), cands, { weather: null, plan: { label: null, source: "none" }, checkIn: [], restingIds: [], noRepeatDays: 0 }, 3, "")).toEqual(boards.slice(0, 2));
  });
});

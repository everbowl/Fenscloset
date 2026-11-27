import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { drainQueue } from "@/lib/import/queue";
import { createStoreEntries, lookupProduct } from "@/lib/store/add";
import { laundryCopies, setCopies, setLaundry, splitOneOff } from "@/lib/items/service";
import { applyCopyAction, copiesLine, copiesWord, countsFor, countsOf, laundrySummary } from "@/lib/items/copies";
import { loadCandidates } from "@/lib/outfits/catalog";
import { wearItems } from "@/lib/outfits/engine";
import { cleanOutDecision, copiesNeeded, listStacks } from "@/lib/outfits/cleanout";

const dayBefore = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

describe("copies: ten of the same shirt as one card (owner, 2–3 Nov 2026, F1 + C1)", () => {
  let avery: { id: string; role: "admin" };
  beforeEach(async () => {
    await resetDb(); process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true"; process.env.MOCK_FETCH = "true"; process.env.MOCK_SERPER = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-copies-"));
    await seed();
    avery = { id: (await db.person.findUniqueOrThrow({ where: { email: "avery@example.test" } })).id, role: "admin" };
  });

  async function stackOf(n: number) {
    const p = await lookupProduct("https://mock.example/products/linen-blazer");
    const r = await createStoreEntries(avery.id, { product: p, imageUrl: p.colorImages.Black, color: "Black", size: "M", quantity: n });
    await drainQueue();
    const entry = await db.importEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] } });
    expect(entry.status).toBe("done"); // C1: a piece with store facts lands in the closet on its own
    return db.item.findUniqueOrThrow({ where: { id: entry.itemId! } });
  }

  it("counts: the summary word, one tap at a time, the card word and how many a stack needs", () => {
    expect(laundrySummary({ copies: 3, dirtyCopies: 0, cleanersCopies: 0 })).toBe("clean");
    expect(laundrySummary({ copies: 3, dirtyCopies: 2, cleanersCopies: 1 })).toBe("dirty");
    expect(laundrySummary({ copies: 2, dirtyCopies: 0, cleanersCopies: 2 })).toBe("cleaners");
    expect(countsFor(4, "dirty")).toEqual({ copies: 4, dirtyCopies: 4, cleanersCopies: 0 });
    expect(countsOf({ copies: 1, dirtyCopies: 0, cleanersCopies: 0, laundryStatus: "cleaners" })).toEqual({ copies: 1, dirtyCopies: 0, cleanersCopies: 1 }); // a single piece follows its word
    expect(countsOf({ copies: 3, dirtyCopies: 5, cleanersCopies: 5, laundryStatus: "clean" })).toEqual({ copies: 3, dirtyCopies: 3, cleanersCopies: 0 }); // never more than the copies
    let c = { copies: 3, dirtyCopies: 0, cleanersCopies: 0 };
    c = applyCopyAction(c, "one_dirty"); c = applyCopyAction(c, "one_cleaners");
    expect(c).toEqual({ copies: 3, dirtyCopies: 1, cleanersCopies: 1 });
    expect(copiesWord(c)).toBe("×3 · 1 clean");
    expect(copiesLine(c)).toBe("1 clean · 1 in the wash · 1 at cleaners");
    c = applyCopyAction(c, "one_dirty"); expect(applyCopyAction(c, "one_dirty")).toEqual(c); // nothing clean left to wear
    expect(applyCopyAction(c, "one_clean")).toEqual({ copies: 3, dirtyCopies: 1, cleanersCopies: 1 });
    expect(applyCopyAction(c, "all_clean")).toEqual({ copies: 3, dirtyCopies: 0, cleanersCopies: 0 });
    expect(copiesWord({ copies: 1, dirtyCopies: 0, cleanersCopies: 0 })).toBeNull();
    expect(copiesNeeded(0, 7)).toBe(1);
    expect(copiesNeeded(5, 7)).toBe(1); // five wears over ~13 washes
    expect(copiesNeeded(40, 7)).toBe(4);
    expect(copiesNeeded(10, 30)).toBe(4); // a wash every month: 90 days is 3 cycles
  });

  it("a store row with a count is one card with that many copies; laundry moves one copy at a time; copies can be set or split off", async () => {
    const item = await stackOf(3);
    expect(item.copies).toBe(3);
    expect(item.storePhoto).toBe(true);
    expect(item.laundryStatus).toBe("clean");
    let v = await laundryCopies(avery, item.id, "one_dirty");
    expect(v).toMatchObject({ dirtyCopies: 1, laundryStatus: "clean" }); // two still clean: Today may keep offering it
    await laundryCopies(avery, item.id, "one_dirty");
    v = await laundryCopies(avery, item.id, "one_cleaners");
    expect(v).toMatchObject({ dirtyCopies: 2, cleanersCopies: 1, laundryStatus: "dirty" });
    v = await laundryCopies(avery, item.id, "all_clean");
    expect(v).toMatchObject({ dirtyCopies: 0, cleanersCopies: 0, laundryStatus: "clean" });
    // the three-state tap moves the whole stack
    expect(await setLaundry(avery, item.id, "cleaners")).toBe("cleaners");
    expect(await db.item.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ cleanersCopies: 3, laundryStatus: "cleaners" });
    await setLaundry(avery, item.id, "clean");
    expect(await setCopies(avery, item.id, 2)).toMatchObject({ copies: 2, laundryStatus: "clean" });
    await expect(setCopies(avery, item.id, 0)).rejects.toThrow(/1 to 99/);
    const newId = await splitOneOff(avery, item.id);
    const [one, rest] = await Promise.all([db.item.findUniqueOrThrow({ where: { id: newId }, include: { photos: true, colors: true } }), db.item.findUniqueOrThrow({ where: { id: item.id } })]);
    expect(one.copies).toBe(1);
    expect(rest.copies).toBe(1);
    expect(one.name).toBe(rest.name);
    expect(one.photos.length).toBeGreaterThan(0);
    await expect(splitOneOff(avery, item.id)).rejects.toThrow(/single piece/);
  });

  it("a stack rests only once every copy was worn inside the window; the clean-out says when ten is too many", async () => {
    const item = await stackOf(3);
    const wear = (daysAgo: number) => wearItems(avery.id, dayBefore(daysAgo), [item.id], { title: "t", now: new Date(`${dayBefore(daysAgo)}T12:00:00Z`) });
    // days 4, 3 and 2 ago: all before "today" in the household's time zone (a wear logged today is never "resting")
    await wear(4); await wear(3);
    let set = await loadCandidates(avery.id, new Date());
    expect(set.usable.some((c) => c.id === item.id)).toBe(true); // two of three worn: one copy is still fresh
    expect(set.restingIds).not.toContain(item.id);
    await wear(2);
    set = await loadCandidates(avery.id, new Date());
    expect(set.restingIds).toContain(item.id); // all three worn inside the no-repeat window
    // ten copies, three wears in 90 days: one would do with a wash a week
    await setCopies(avery, item.id, 10);
    const stacks = await listStacks(avery.id, new Date());
    expect(stacks).toHaveLength(1);
    expect(stacks[0]).toMatchObject({ id: item.id, copies: 10, wears90: 3, keep: 1, cycleDays: 7 });
    await cleanOutDecision(avery, item.id, "trim", new Date(), 2);
    expect((await db.item.findUniqueOrThrow({ where: { id: item.id } })).copies).toBe(2);
    await expect(cleanOutDecision(avery, item.id, "trim", new Date(), 5)).rejects.toThrow(/fewer/);
    // "Leave it" hides the advice for three months
    await setCopies(avery, item.id, 10);
    await cleanOutDecision(avery, item.id, "keep");
    expect(await listStacks(avery.id, new Date())).toHaveLength(0);
  });
});

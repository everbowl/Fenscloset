import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { forgetJobs, settled } from "@/lib/jobs";
import { acquireSweepLease, addWant, deleteWant, editWant, getWant, listWants, mergeMatches, newMatchCount, openWant, priceCapOf, releaseSweepLease, searchWant, searchWantNow, setWantFound, STORES_DID_NOT_ANSWER, sweepWants } from "@/lib/shop/wants";
import type { Product } from "@/lib/shop/products";

const product = (n: number, price: number): Product => ({ title: `Sweater ${n}`, priceText: `$${price}.00`, storeName: "Mock", url: `https://mock.example/s/${n}`, imageUrl: null, query: "sweater" });

describe("looking for", () => {
  beforeEach(async () => {
    await resetDb(); forgetJobs();
    process.env.MOCK_AI = "true"; process.env.MOCK_SERPER = "true"; process.env.MOCK_FETCH = "true"; process.env.MOCK_S3 = "true";
    await seed();
  });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });

  it("reads a price cap and merges only what is new and under it", () => {
    expect(priceCapOf("navy cashmere crewneck under $200")).toBe(200);
    expect(priceCapOf("white sneakers, less than 150")).toBe(150);
    expect(priceCapOf("$80 max linen shirt")).toBe(80);
    expect(priceCapOf("camel overcoat under $1,200")).toBe(1200); // review E F4: read as $1 before
    expect(priceCapOf("black leather belt")).toBeNull();
    const first = mergeMatches([], [product(1, 48), product(2, 108), product(3, 88)], 100, new Date("2026-10-24T00:00:00Z"));
    expect(first.added).toBe(2);
    expect(first.matches.map((m) => m.url)).toEqual(["https://mock.example/s/1", "https://mock.example/s/3"]);
    // the next day: one known, one new; the new one goes in front
    const next = mergeMatches(first.matches, [product(1, 48), product(4, 60)], 100, new Date("2026-10-25T00:00:00Z"));
    expect(next.added).toBe(1);
    expect(next.matches[0]).toMatchObject({ url: "https://mock.example/s/4", firstSeenAt: "2026-10-25T00:00:00.000Z" });
    expect(next.matches).toHaveLength(3);
    // no cap: everything new counts
    expect(mergeMatches([], [product(1, 48), product(2, 108)], null).added).toBe(2);
  });

  it("add → searched in the background with the steps; the count is new until opened; a later search counts only what is new; found and remove", async () => {
    const [jeff, olivia, mya] = await Promise.all([by("Jeff"), by("Olivia"), by("Mya")]);
    const steps: string[] = [];
    const added = await addWant(jeff, jeff.id, "  navy cashmere crewneck   under $100 ");
    const done = await settled(added.job, 15_000);
    expect(done.state).toBe("done");
    let v = (await getWant(jeff, added.id))!;
    expect(v.text).toBe("navy cashmere crewneck under $100");
    expect(v.queries[0]).toBe("men's navy cashmere crewneck"); // the price words stay out of the search; Jeff's section (Men's, seeded) leads it
    expect(v.category).toBe("Tops");
    expect(v.maxPrice).toBe(100);
    expect(v.matches.length).toBeGreaterThan(0);
    for (const m of v.matches) expect(Number(m.priceText!.replace(/[^\d.]/g, ""))).toBeLessThanOrEqual(100);
    expect(v.newCount).toBe(v.matches.length);
    expect(v.lastSearchedAt).not.toBeNull();
    expect(v.matches.every((m) => m.isNew)).toBe(true);
    // the Shop's line and Today's strip
    expect(await newMatchCount(jeff, jeff.id)).toEqual({ wants: 1, newMatches: v.matches.length });
    // opening it: the new ones are marked this once, then counted as seen
    const opened = (await openWant(jeff, added.id))!;
    expect(opened.matches.every((m) => m.isNew)).toBe(true);
    v = (await getWant(jeff, added.id))!;
    expect(v.newCount).toBe(0);
    expect(v.matches.some((m) => m.isNew)).toBe(false);
    expect(await newMatchCount(jeff, jeff.id)).toEqual({ wants: 1, newMatches: 0 });
    // the stores answer the same again: nothing new
    const again = await searchWant(added.id, { step: (s) => steps.push(s) });
    expect(again.added).toBe(0);
    expect(steps).toEqual(["Searching the stores…"]); // the line was read once; no second Claude call
    // a product the stores did not have before shows up as new, in front
    const row = await db.want.findUniqueOrThrow({ where: { id: added.id } });
    const matches = row.matches as { url: string }[];
    const gone = matches[2];
    await db.want.update({ where: { id: added.id }, data: { matches: matches.filter((m) => m.url !== gone.url) as object[] } });
    const job = await searchWantNow(jeff, added.id);
    expect((await settled(job, 15_000)).state).toBe("done");
    v = (await getWant(jeff, added.id))!;
    expect(v.newCount).toBe(1);
    expect(v.matches[0].url).toBe(gone.url);
    expect(v.matches[0].isNew).toBe(true);
    expect(v.matches.filter((m) => m.isNew)).toHaveLength(1);
    // Olivia may not see Jeff's list; Jeff keeps one for Mya (a parent); Olivia may not add to Jeff's
    expect(await listWants(olivia, jeff.id)).toEqual([]);
    // review E A6: a shopper whose grant is taken back loses the lines they added, too
    await db.shopForGrant.create({ data: { ownerId: jeff.id, shopperId: olivia.id } });
    const byOlivia = await addWant(olivia, jeff.id, "black boots");
    await settled(byOlivia.job, 15_000);
    expect(await getWant(olivia, byOlivia.id)).not.toBeNull();
    await db.shopForGrant.deleteMany({ where: { ownerId: jeff.id, shopperId: olivia.id } });
    expect(await getWant(olivia, byOlivia.id)).toBeNull();
    await expect(deleteWant(olivia, byOlivia.id)).rejects.toMatchObject({ status: 404 });
    await deleteWant(jeff, byOlivia.id);
    expect(await getWant(olivia, added.id)).toBeNull();
    await expect(editWant(olivia, added.id, "something else")).rejects.toMatchObject({ status: 404 });
    await expect(addWant(olivia, jeff.id, "black boots")).rejects.toMatchObject({ status: 403 });
    await expect(addWant(jeff, jeff.id, "x")).rejects.toMatchObject({ status: 400 });
    const forMya = await addWant(jeff, mya.id, "white sneakers");
    await settled(forMya.job, 15_000);
    expect((await listWants(jeff, mya.id)).map((w) => w.forName)).toEqual(["Mya"]);
    expect((await listWants(mya, mya.id)).map((w) => w.text)).toEqual(["white sneakers"]);
    expect((await getWant(jeff, forMya.id))!.category).toBe("Shoes");
    // edit: read again, matches start over
    const edited = await editWant(jeff, added.id, "camel wool overcoat under $300");
    await settled(edited, 15_000);
    v = (await getWant(jeff, added.id))!;
    expect(v.text).toBe("camel wool overcoat under $300");
    expect(v.category).toBe("Outerwear");
    expect(v.maxPrice).toBe(300);
    expect(v.newCount).toBe(v.matches.length);
    // found: kept under Found, out of the counts; back on the list; removed
    await setWantFound(jeff, added.id, true);
    const list = await listWants(jeff, jeff.id);
    expect(list.map((w) => Boolean(w.foundAt))).toEqual([true]);
    expect(await newMatchCount(jeff, jeff.id)).toEqual({ wants: 0, newMatches: 0 });
    await setWantFound(jeff, added.id, false);
    expect((await getWant(jeff, added.id))!.foundAt).toBeNull();
    await deleteWant(jeff, added.id);
    expect(await getWant(jeff, added.id)).toBeNull();
    await expect(deleteWant(jeff, added.id)).rejects.toMatchObject({ status: 404 });
  });

  it("a search the stores or the judge fail still marks the line checked, with the reason, and the next good one clears it (review E C3)", async () => {
    const jeff = await by("Jeff");
    const want = await addWant(jeff, jeff.id, "grey marl hoodie under $1,200");
    await settled(want.job, 15_000);
    let v = (await getWant(jeff, want.id))!;
    expect(v.maxPrice).toBe(1200);
    expect(v.lastError).toBeNull();
    // every store answer fails: the stores' key is gone and the mock is off, so the search throws
    const before = v.lastSearchedAt!.getTime();
    delete process.env.MOCK_SERPER; process.env.SERPER_API_KEY = "test-key";
    const broken = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    const realFetch = globalThis.fetch; globalThis.fetch = broken;
    try { await expect(searchWant(want.id, { maxAgeHours: 0 })).rejects.toMatchObject({ message: STORES_DID_NOT_ANSWER }); }
    finally { globalThis.fetch = realFetch; process.env.MOCK_SERPER = "true"; }
    v = (await getWant(jeff, want.id))!;
    expect(v.lastError).toBe(STORES_DID_NOT_ANSWER);
    expect(v.lastSearchedAt!.getTime()).toBeGreaterThanOrEqual(before); // never "Searching the stores…" forever
    expect(v.matches.length).toBeGreaterThan(0); // what was found before stays
    // a good search clears the note
    await searchWant(want.id);
    expect((await getWant(jeff, want.id))!.lastError).toBeNull();
    // the sweep's lease: one process at a time
    await releaseSweepLease();
    expect(await acquireSweepLease()).toBe(true);
    expect(await acquireSweepLease()).toBe(false);
    expect(await acquireSweepLease(new Date(Date.now() + 30 * 60_000))).toBe(true); // lapsed
    await releaseSweepLease();
  });

  it("the sweep searches open wants whose last check is older than the rule, skips found ones, and is off at 0", async () => {
    const jeff = await by("Jeff");
    const old = await addWant(jeff, jeff.id, "grey marl hoodie");
    const fresh = await addWant(jeff, jeff.id, "white linen shirt");
    const found = await addWant(jeff, jeff.id, "black belt");
    await Promise.all([settled(old.job, 15_000), settled(fresh.job, 15_000), settled(found.job, 15_000)]);
    await setWantFound(jeff, found.id, true);
    const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000);
    await db.want.updateMany({ where: { id: { in: [old.id, found.id] } }, data: { lastSearchedAt: twoDaysAgo } });
    const lines: string[] = [];
    const r = await sweepWants(new Date(), (l) => lines.push(l));
    expect(r).toEqual({ searched: 1, added: 0, failed: 0 });
    expect(lines).toEqual(["looking for: searched 1, 0 new"]);
    expect((await db.want.findUniqueOrThrow({ where: { id: old.id } })).lastSearchedAt!.getTime()).toBeGreaterThan(twoDaysAgo.getTime());
    expect((await db.want.findUniqueOrThrow({ where: { id: found.id } })).lastSearchedAt!.getTime()).toBe(twoDaysAgo.getTime());
    // nothing due now
    expect((await sweepWants()).searched).toBe(0);
    // a never-searched want is due at once; the rule at 0 turns the sweep off
    await db.want.update({ where: { id: fresh.id }, data: { lastSearchedAt: null } });
    await db.rule.update({ where: { key: "wantSweepHours" }, data: { value: "0" } });
    expect((await sweepWants()).searched).toBe(0);
    await db.rule.update({ where: { key: "wantSweepHours" }, data: { value: "24" } });
    expect((await sweepWants()).searched).toBe(1);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { forgetJobs, settled } from "@/lib/jobs";
import { getBrandFeed, interleave, openBrandFeed, refreshBrandFeed, refreshBrandFeedNow, sweepBrandFeeds } from "@/lib/shop/brand-feed";
import type { Product } from "@/lib/shop/products";

const product = (n: string, i: number): Product => ({ title: `${n} ${i}`, priceText: "$50.00", storeName: n, url: `https://mock.example/${n}/${i}`, imageUrl: null, query: n });

async function favor(personId: string, ...brands: string[]) {
  const ids: { id: string }[] = [];
  for (const name of brands) ids.push(await db.brand.upsert({ where: { name }, update: { isArchived: false }, create: { name }, select: { id: true } }));
  await db.person.update({ where: { id: personId }, data: { favoriteBrands: { set: ids } } });
}

describe("new from your brands", () => {
  beforeEach(async () => {
    await resetDb(); forgetJobs();
    process.env.MOCK_AI = "true"; process.env.MOCK_SERPER = "true"; process.env.MOCK_FETCH = "true"; process.env.MOCK_S3 = "true";
    await seed();
  });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });

  it("interleaves the brands so each gets a turn and drops repeats", () => {
    const out = interleave([[product("a", 1), product("a", 2)], [product("b", 1)], [product("a", 1), product("c", 1)]]);
    expect(out.map((p) => p.url)).toEqual(["https://mock.example/a/1", "https://mock.example/b/1", "https://mock.example/a/2", "https://mock.example/c/1"]); // round one of each list, then round two; a/1 again is dropped
  });

  it("builds the feed from the favorite brands, counts what is new until the Shop opens, goes stale on the schedule or a brand change; only who may shop for the person", async () => {
    const [jeff, olivia, mya] = await Promise.all([by("Jeff"), by("Olivia"), by("Mya")]);
    await favor(jeff.id, "Everlane", "Vuori");
    const r = await refreshBrandFeed(jeff.id);
    expect(r.brands).toEqual(["Everlane", "Vuori"]);
    expect(r.added).toBeGreaterThan(2);
    let v = (await getBrandFeed(jeff, jeff.id))!;
    expect(v.brands).toEqual(["Everlane", "Vuori"]);
    expect(v.products).toHaveLength(r.added);
    expect(v.products[0].title).toMatch(/Everlane/);
    expect(v.products[1].title).toMatch(/Vuori/);
    expect(v.newCount).toBe(r.added);
    expect(v.products.every((p) => p.isNew)).toBe(true);
    expect(v.stale).toBe(false);
    expect(v.lastFetchedAt).not.toBeNull();
    // the Shop opens it: new this once, then seen
    expect((await openBrandFeed(jeff, jeff.id))!.newCount).toBe(r.added);
    v = (await getBrandFeed(jeff, jeff.id))!;
    expect(v.newCount).toBe(0);
    expect(v.products.some((p) => p.isNew)).toBe(false);
    // the stores answer the same: nothing new; a product not seen before shows up new, in front
    expect((await refreshBrandFeed(jeff.id)).added).toBe(0);
    const row = await db.brandFeed.findUniqueOrThrow({ where: { personId: jeff.id } });
    const products = row.products as { url: string }[];
    const gone = products[1];
    await db.brandFeed.update({ where: { personId: jeff.id }, data: { products: products.filter((p) => p.url !== gone.url) as object[] } });
    const job = await refreshBrandFeedNow(jeff, jeff.id);
    expect((await settled(job, 15_000)).state).toBe("done");
    v = (await getBrandFeed(jeff, jeff.id))!;
    expect(v.newCount).toBe(1);
    expect(v.products[0].url).toBe(gone.url);
    expect(v.products[0].isNew).toBe(true);
    // a new favorite brand makes the feed stale; the refresh picks it up
    await favor(jeff.id, "Everlane", "Vuori", "J.Crew");
    expect((await getBrandFeed(jeff, jeff.id))!.stale).toBe(true);
    await refreshBrandFeed(jeff.id);
    v = (await getBrandFeed(jeff, jeff.id))!;
    expect(v.brands).toEqual(["Everlane", "J.Crew", "Vuori"]); // alphabetical, so the row reads the same every day
    expect(v.stale).toBe(false);
    expect(v.products.some((p) => /J\.Crew/.test(p.title))).toBe(true);
    // older than the schedule: stale again
    await db.brandFeed.update({ where: { personId: jeff.id }, data: { lastFetchedAt: new Date(Date.now() - 25 * 3600 * 1000) } });
    expect((await getBrandFeed(jeff, jeff.id))!.stale).toBe(true);
    // no favorite brands: nothing to fetch, never stale
    const forMya = (await getBrandFeed(jeff, mya.id))!;
    expect(forMya).toMatchObject({ brands: [], products: [], newCount: 0, stale: false });
    // Olivia may not see Jeff's feed or refresh it
    expect(await getBrandFeed(olivia, jeff.id)).toBeNull();
    await expect(refreshBrandFeedNow(olivia, jeff.id)).rejects.toMatchObject({ status: 403 });
  });

  it("the sweep refreshes feeds older than the rule for people with favorite brands, and is off at 0", async () => {
    const [jeff, brittney] = await Promise.all([by("Jeff"), by("Brittney")]);
    await favor(jeff.id, "Everlane");
    await favor(brittney.id, "Vuori");
    await refreshBrandFeed(jeff.id);
    await refreshBrandFeed(brittney.id);
    const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000);
    await db.brandFeed.update({ where: { personId: jeff.id }, data: { lastFetchedAt: twoDaysAgo } });
    const lines: string[] = [];
    expect(await sweepBrandFeeds(new Date(), (l) => lines.push(l))).toEqual({ refreshed: 1, added: 0, failed: 0 });
    expect(lines).toEqual(["brand feed: refreshed 1, 0 new"]);
    expect((await db.brandFeed.findUniqueOrThrow({ where: { personId: jeff.id } })).lastFetchedAt!.getTime()).toBeGreaterThan(twoDaysAgo.getTime());
    expect((await sweepBrandFeeds()).refreshed).toBe(0);
    // a person with brands and no feed yet is refreshed at once; the rule at 0 turns it off
    await db.brandFeed.delete({ where: { personId: brittney.id } });
    await db.rule.update({ where: { key: "wantSweepHours" }, data: { value: "0" } });
    expect((await sweepBrandFeeds()).refreshed).toBe(0);
    await db.rule.update({ where: { key: "wantSweepHours" }, data: { value: "24" } });
    expect((await sweepBrandFeeds()).refreshed).toBe(1);
  });
});

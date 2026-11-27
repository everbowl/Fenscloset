import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetDb, seed } from "../helpers";
import { FIXTURE_ADMIN_EMAIL } from "../fixtures/people-data";
import { setRule } from "@/lib/rules";
import { AI_CAP_MINIMUM, AiCapError, aiCaps, chargeAi, dayKey, HOUSEHOLD_BUCKET, isAiCapError } from "@/lib/ai/usage";
import { removeBackground } from "@/lib/images/remove-bg";
import { searchProducts } from "@/lib/shop/products";

vi.mock("server-only", () => ({}));

const admin = () => db.person.findUniqueOrThrow({ where: { email: FIXTURE_ADMIN_EMAIL } });
const other = () => db.person.findFirstOrThrow({ where: { name: "Blake" } });

describe("AI spend caps (security item 8)", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
    process.env.MOCK_AI = "true"; process.env.MOCK_SERPER = "true"; process.env.MOCK_TRYON = "true";
  });

  it("the caps are rules with a floor; the day is the household's day", async () => {
    expect((await aiCaps()).aiPerPersonTryOn).toBe(20);
    await setRule("aiPerPersonTryOn", "0"); // an admin tries to switch the cap off
    expect((await aiCaps()).aiPerPersonTryOn).toBe(AI_CAP_MINIMUM);
    expect(dayKey("America/Los_Angeles", new Date("2026-11-27T05:00:00Z"))).toBe("2026-11-26"); // still the 26th in Los Angeles
    expect(dayKey("UTC", new Date("2026-11-27T05:00:00Z"))).toBe("2026-11-27");
  });

  it("the (cap+1)th call for one person is refused and charges nothing; another person is unaffected", async () => {
    await setRule("aiPerPersonClaude", "2");
    const a = await admin(); const b = await other();
    await chargeAi("claude", a.id);
    await chargeAi("claude", a.id);
    await expect(chargeAi("claude", a.id)).rejects.toBeInstanceOf(AiCapError);
    const row = await db.aiUsage.findFirstOrThrow({ where: { personId: a.id, provider: "claude" } });
    expect(row.count).toBe(2); // the refused call left no charge behind
    await expect(chargeAi("claude", b.id)).resolves.toBeUndefined();
    await expect(chargeAi("tryon", a.id)).resolves.toBeUndefined(); // a different provider has its own cap
  });

  it("the household ceiling stops everyone, background work included, before any charge", async () => {
    await setRule("aiHouseholdPerDay", "3");
    const a = await admin(); const b = await other();
    await chargeAi("shop", a.id); await chargeAi("shop", b.id); await chargeAi("removebg", a.id);
    let err: unknown;
    try { await chargeAi("shop"); } catch (e) { err = e; } // no person: a background sweep, charged to the household bucket
    expect(isAiCapError(err) && (err as AiCapError).scope).toBe("household");
    expect(await db.aiUsage.count({ where: { personId: HOUSEHOLD_BUCKET } })).toBe(0);
    await expect(chargeAi("claude", b.id)).rejects.toMatchObject({ scope: "household" });
  });

  it("remove.bg and the shop lookups are charged before their mocks run: past the cap no provider work happens", async () => {
    const a = await admin();
    await setRule("aiPerPersonRemoveBg", "1");
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } }).jpeg().toBuffer();
    expect((await removeBackground(jpeg, { personId: a.id })).length).toBeGreaterThan(0);
    await expect(removeBackground(jpeg, { personId: a.id })).rejects.toBeInstanceOf(AiCapError);
    await setRule("aiPerPersonShop", "1");
    expect((await searchProducts(["linen blazer"], { favoriteStores: [], favoriteBrands: [], section: "Men's" }, fetch, { personId: a.id })).length).toBeGreaterThan(0);
    await expect(searchProducts(["linen blazer"], { favoriteStores: [], favoriteBrands: [], section: "Men's" }, fetch, { personId: a.id })).rejects.toBeInstanceOf(AiCapError);
    expect(await db.aiUsage.count({ where: { personId: a.id, provider: "shop" } })).toBe(1);
  });
});

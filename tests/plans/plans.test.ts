import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { calendarNeedsReconnect, getPlan, planLine, setPlan } from "@/lib/plans";
import { connectUrl, disconnect, finishConnect, getConnection, isGoogleConfigured, listCalendars, markCalendarBroken, personFromState, setCalendarIds } from "@/lib/plans/google";
import { decrypt, encrypt, sign, verify } from "@/lib/crypto";

describe("plans & Google Calendar", () => {
  beforeEach(async () => { await resetDb(); process.env.MOCK_GOOGLE = "true"; await seed(); });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });

  it("crypto round-trips and rejects tampered state", () => {
    expect(decrypt(encrypt("refresh-123"))).toBe("refresh-123");
    const s = sign("abc:1");
    expect(verify(s)).toBe("abc:1");
    expect(verify(s.slice(0, -2) + "zz")).toBeNull();
  });

  it("pick beats calendar beats nothing; connection state is signed per person", async () => {
    const [avery, casey] = await Promise.all([by("Avery"), by("Casey")]);
    const tz = "America/Los_Angeles";
    const noon = new Date("2026-10-18T19:00:00Z"); // noon LA
    expect(isGoogleConfigured()).toBe(true);
    expect(await getPlan(avery.id, "2026-10-18", tz, noon)).toMatchObject({ source: "none" });
    const url = new URL(connectUrl(avery.id));
    expect(url.searchParams.get("scope")).toContain("calendar.readonly");
    expect(personFromState(url.searchParams.get("state")!)).toBe(avery.id);
    expect(personFromState("forged.sig")).toBeNull();
    await finishConnect(avery.id, "code");
    expect((await getConnection(avery.id))?.email).toBe("mock@example.com");
    expect((await listCalendars(avery.id)).map((c) => c.name)).toEqual(["mock@example.com", "Family"]);
    await setCalendarIds(avery.id, ["primary", "family@group.calendar.google.com"]);
    expect((await getConnection(avery.id))?.calendarIds).toHaveLength(2);
    expect(await listCalendars(casey.id)).toEqual([]);
    const cal = await getPlan(avery.id, "2026-10-18", tz, new Date("2026-10-18T12:00:00"));
    expect(cal).toMatchObject({ source: "calendar", label: "Dinner" });
    expect(planLine(cal, tz)).toMatch(/^DINNER \d{1,2}:\d{2} [AP]M$/);
    const occ = await db.occasion.findFirstOrThrow({ where: { name: "Gym" } });
    await setPlan(avery, avery.id, "2026-10-18", { occasionId: occ.id });
    expect(await getPlan(avery.id, "2026-10-18", tz, noon)).toMatchObject({ source: "pick", label: "Gym", occasionId: occ.id });
    await setPlan(avery, avery.id, "2026-10-18", { text: "Beach day" });
    expect(planLine(await getPlan(avery.id, "2026-10-18", tz, noon), tz)).toBe("BEACH DAY");
    await expect(setPlan(casey, avery.id, "2026-10-18", null)).rejects.toMatchObject({ status: 403 });
    await setPlan(avery, avery.id, "2026-10-18", null);
    await disconnect(avery.id);
    expect(await getConnection(avery.id)).toBeNull();
    expect(await getPlan(avery.id, "2026-10-18", tz, noon)).toMatchObject({ source: "none" });
  });

  it("a connection Google refused is marked as needing a reconnect; connecting again, or disconnecting, clears it (review D 5.2)", async () => {
    const avery = await by("Avery");
    expect(await calendarNeedsReconnect(avery.id)).toBe(false);
    await finishConnect(avery.id, "code");
    expect(await calendarNeedsReconnect(avery.id)).toBe(false);
    await markCalendarBroken(avery.id, "Google: Token has been expired or revoked.");
    expect(await calendarNeedsReconnect(avery.id)).toBe(true);
    expect(await getConnection(avery.id)).not.toBeNull(); // the row stays, so Settings can offer "Connect again" instead of "Connect"
    await finishConnect(avery.id, "code");
    expect(await calendarNeedsReconnect(avery.id)).toBe(false);
    await markCalendarBroken(avery.id, "invalid_grant");
    await disconnect(avery.id);
    expect(await calendarNeedsReconnect(avery.id)).toBe(false); // no connection: nothing to reconnect
    expect(await db.weatherCache.count({ where: { key: { startsWith: "gcal" } } })).toBe(0);
  });
});

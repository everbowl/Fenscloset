import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
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
    const [jeff, olivia] = await Promise.all([by("Jeff"), by("Olivia")]);
    const tz = "America/Los_Angeles";
    const noon = new Date("2026-10-18T19:00:00Z"); // noon LA
    expect(isGoogleConfigured()).toBe(true);
    expect(await getPlan(jeff.id, "2026-10-18", tz, noon)).toMatchObject({ source: "none" });
    const url = new URL(connectUrl(jeff.id));
    expect(url.searchParams.get("scope")).toContain("calendar.readonly");
    expect(personFromState(url.searchParams.get("state")!)).toBe(jeff.id);
    expect(personFromState("forged.sig")).toBeNull();
    await finishConnect(jeff.id, "code");
    expect((await getConnection(jeff.id))?.email).toBe("mock@example.com");
    expect((await listCalendars(jeff.id)).map((c) => c.name)).toEqual(["mock@example.com", "Family"]);
    await setCalendarIds(jeff.id, ["primary", "family@group.calendar.google.com"]);
    expect((await getConnection(jeff.id))?.calendarIds).toHaveLength(2);
    expect(await listCalendars(olivia.id)).toEqual([]);
    const cal = await getPlan(jeff.id, "2026-10-18", tz, new Date("2026-10-18T12:00:00"));
    expect(cal).toMatchObject({ source: "calendar", label: "Dinner" });
    expect(planLine(cal, tz)).toMatch(/^DINNER \d{1,2}:\d{2} [AP]M$/);
    const occ = await db.occasion.findFirstOrThrow({ where: { name: "Gym" } });
    await setPlan(jeff, jeff.id, "2026-10-18", { occasionId: occ.id });
    expect(await getPlan(jeff.id, "2026-10-18", tz, noon)).toMatchObject({ source: "pick", label: "Gym", occasionId: occ.id });
    await setPlan(jeff, jeff.id, "2026-10-18", { text: "Beach day" });
    expect(planLine(await getPlan(jeff.id, "2026-10-18", tz, noon), tz)).toBe("BEACH DAY");
    await expect(setPlan(olivia, jeff.id, "2026-10-18", null)).rejects.toMatchObject({ status: 403 });
    await setPlan(jeff, jeff.id, "2026-10-18", null);
    await disconnect(jeff.id);
    expect(await getConnection(jeff.id)).toBeNull();
    expect(await getPlan(jeff.id, "2026-10-18", tz, noon)).toMatchObject({ source: "none" });
  });

  it("a connection Google refused is marked as needing a reconnect; connecting again, or disconnecting, clears it (review D 5.2)", async () => {
    const jeff = await by("Jeff");
    expect(await calendarNeedsReconnect(jeff.id)).toBe(false);
    await finishConnect(jeff.id, "code");
    expect(await calendarNeedsReconnect(jeff.id)).toBe(false);
    await markCalendarBroken(jeff.id, "Google: Token has been expired or revoked.");
    expect(await calendarNeedsReconnect(jeff.id)).toBe(true);
    expect(await getConnection(jeff.id)).not.toBeNull(); // the row stays, so Settings can offer "Connect again" instead of "Connect"
    await finishConnect(jeff.id, "code");
    expect(await calendarNeedsReconnect(jeff.id)).toBe(false);
    await markCalendarBroken(jeff.id, "invalid_grant");
    await disconnect(jeff.id);
    expect(await calendarNeedsReconnect(jeff.id)).toBe(false); // no connection: nothing to reconnect
    expect(await db.weatherCache.count({ where: { key: { startsWith: "gcal" } } })).toBe(0);
  });
});

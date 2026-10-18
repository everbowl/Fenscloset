import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { getPlan, planLine, setPlan } from "@/lib/plans";
import { connectUrl, disconnect, finishConnect, getConnection, isGoogleConfigured, personFromState } from "@/lib/plans/google";
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
});

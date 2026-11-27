import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetDb, seed } from "../helpers";
import { FIXTURE_ADMIN_EMAIL } from "../fixtures/people-data";
import { saveSelfie, getCheckIn } from "@/lib/checkins/service";

vi.mock("server-only", () => ({}));
// Claude is a spy here: the point is who gets asked and who never does.
const structured = vi.fn(async () => ({}));
vi.mock("@/lib/ai/claude", async (orig) => ({ ...(await orig<object>()), structured: (...a: unknown[]) => structured(...(a as [])), isMockAi: () => false }));

describe("minors' check-in selfies stay home (security item 8, decision C1)", () => {
  beforeEach(async () => { await resetDb(); await seed(); process.env.MOCK_S3 = "true"; structured.mockClear(); });

  it("a minor's selfie is stored for the family, but never sent to the AI reader; an adult's is read", async () => {
    const sharp = (await import("sharp")).default;
    const photo = { data: await sharp({ create: { width: 16, height: 16, channels: 3, background: "#caa" } }).jpeg().toBuffer(), contentType: "image/jpeg" as const };
    const parent = await db.person.findUniqueOrThrow({ where: { email: FIXTURE_ADMIN_EMAIL } });
    const minor = await db.person.findFirstOrThrow({ where: { role: "minor" } });
    const viewer = { id: parent.id, role: parent.role } as never;
    const view = await saveSelfie(viewer, minor.id, "2026-11-27", photo);
    expect(view.selfieKey).toBeTruthy();
    expect(structured).not.toHaveBeenCalled();
    expect(await getCheckIn(viewer, minor.id, "2026-11-27")).toMatchObject({ answers: [] });
    structured.mockResolvedValueOnce({});
    await saveSelfie(viewer, parent.id, "2026-11-27", photo);
    expect(structured).toHaveBeenCalledTimes(1);
  });
});

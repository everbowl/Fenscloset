import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { getCheckIn, getScales, saveSelfie, saveTaps } from "@/lib/checkins/service";
import { canViewKey } from "@/lib/photos/visibility";

describe("check-ins", () => {
  beforeEach(async () => {
    await resetDb(); process.env.MOCK_S3 = "true"; process.env.MOCK_AI = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-ci-"));
    await seed();
  });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });

  it("taps save one answer per scale; only the owner or a parent can read/write; selfie maps to options and stays private", async () => {
    const [jeff, olivia, mya] = await Promise.all([by("Jeff"), by("Olivia"), by("Mya")]);
    const scales = await getScales();
    expect(scales.map((s) => s.name)).toEqual(["Tan", "Hair", "Skin"]);
    await saveTaps(jeff, jeff.id, "2026-10-18", [{ scaleId: scales[0].id, optionId: scales[0].options[2].id }]);
    const c = await getCheckIn(jeff, jeff.id, "2026-10-18");
    expect(c).toMatchObject({ source: "taps", answers: [{ scaleName: "Tan", optionName: "Medium" }] });
    expect(await getCheckIn(olivia, jeff.id, "2026-10-18")).toBeNull();
    await expect(saveTaps(olivia, mya.id, "2026-10-18", [])).rejects.toMatchObject({ status: 403 });
    await expect(saveTaps(jeff, jeff.id, "2026-10-18", [{ scaleId: scales[0].id, optionId: "nope" }])).rejects.toMatchObject({ status: 400 });

    const img = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 170, b: 150 } } }).jpeg().toBuffer();
    const s = await saveSelfie(jeff, mya.id, "2026-10-18", { data: img, contentType: "image/jpeg" }); // parent checks in for the minor
    expect(s.source).toBe("selfie");
    expect(s.answers).toHaveLength(3);
    expect(s.selfieKey).toMatch(/^checkins\//);
    expect(await canViewKey(mya, s.selfieKey!)).toBe(true);
    expect(await canViewKey(jeff, s.selfieKey!)).toBe(true);
    expect(await canViewKey(olivia, s.selfieKey!)).toBe(false);
    // re-check-in by taps replaces the selfie
    await saveTaps(mya, mya.id, "2026-10-18", []);
    expect((await getCheckIn(mya, mya.id, "2026-10-18"))!.selfieKey).toBeNull();
  });
});

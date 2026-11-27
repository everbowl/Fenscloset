import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
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
    const [avery, casey, devon] = await Promise.all([by("Avery"), by("Casey"), by("Devon")]);
    const scales = await getScales();
    expect(scales.map((s) => s.name)).toEqual(["Tan", "Hair", "Skin"]);
    await saveTaps(avery, avery.id, "2026-10-18", [{ scaleId: scales[0].id, optionId: scales[0].options[2].id }]);
    const c = await getCheckIn(avery, avery.id, "2026-10-18");
    expect(c).toMatchObject({ source: "taps", answers: [{ scaleName: "Tan", optionName: "Medium" }] });
    expect(await getCheckIn(casey, avery.id, "2026-10-18")).toBeNull();
    await expect(saveTaps(casey, devon.id, "2026-10-18", [])).rejects.toMatchObject({ status: 403 });
    await expect(saveTaps(avery, avery.id, "2026-10-18", [{ scaleId: scales[0].id, optionId: "nope" }])).rejects.toMatchObject({ status: 400 });

    const img = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 170, b: 150 } } }).jpeg().toBuffer();
    const s = await saveSelfie(avery, devon.id, "2026-10-18", { data: img, contentType: "image/jpeg" }); // parent checks in for the minor
    expect(s.source).toBe("selfie");
    expect(s.answers).toHaveLength(0); // security item 8 (C1): a minor's selfie is stored for the family but never sent to the AI
    expect(s.selfieKey).toMatch(/^checkins\//);
    expect(await canViewKey(devon, s.selfieKey!)).toBe(true);
    expect(await canViewKey(avery, s.selfieKey!)).toBe(true);
    expect(await canViewKey(casey, s.selfieKey!)).toBe(false);
    // an adult's own selfie is read: one answer per scale
    const mine = await saveSelfie(avery, avery.id, "2026-10-18", { data: img, contentType: "image/jpeg" });
    expect(mine.source).toBe("selfie");
    expect(mine.answers).toHaveLength(3);
    // re-check-in by taps replaces the selfie
    await saveTaps(devon, devon.id, "2026-10-18", []);
    expect((await getCheckIn(devon, devon.id, "2026-10-18"))!.selfieKey).toBeNull();
  });
});

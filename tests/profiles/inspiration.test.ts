import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { newKey, putObject } from "@/lib/storage";
import { canViewKey } from "@/lib/photos/visibility";
import { addInspiration, inspirationContext, listInspiration, removeInspiration } from "@/lib/profiles/inspiration";
import { styleContext } from "@/lib/outfits/catalog";

describe("inspiration board", () => {
  beforeEach(async () => {
    await resetDb(); process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-inspo-")); await seed();
  });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });
  const jpeg = () => sharp({ create: { width: 200, height: 260, channels: 3, background: { r: 180, g: 160, b: 120 } } }).jpeg().toBuffer();

  it("reads a saved look into style DNA, feeds the style context, keeps it private, and removes", async () => {
    const [avery, blake, casey, devon] = await Promise.all([by("Avery"), by("Blake"), by("Casey"), by("Devon")]);
    const key = newKey("inspo", avery.id, "image/jpeg"); await putObject(key, await jpeg(), "image/jpeg");
    await expect(addInspiration(casey, avery.id, key)).rejects.toMatchObject({ status: 403 });
    const bodyKey = newKey("bodies", avery.id, "image/jpeg");
    await expect(addInspiration(avery, avery.id, bodyKey)).rejects.toMatchObject({ status: 403 }); // wrong kind
    const look = await addInspiration(avery, avery.id, key);
    expect(look.notes.words).toContain("minimal");
    expect((await listInspiration(avery.id)).length).toBe(1);
    const ctx = await inspirationContext(avery.id);
    expect(ctx).toContain("Inspiration board (1 saved looks");
    expect(ctx).toContain("camel + black");
    expect(await styleContext(avery.id)).toContain("Inspiration board");
    // private: Avery's inspiration is Avery's; a minor's is hers and her parents'
    expect(await canViewKey(avery, key)).toBe(true);
    expect(await canViewKey(blake, key)).toBe(false);
    const devonKey = newKey("inspo", devon.id, "image/jpeg"); await putObject(devonKey, await jpeg(), "image/jpeg");
    await addInspiration(avery, devon.id, devonKey); // parent may add for a minor
    expect(await canViewKey(devon, devonKey)).toBe(true);
    expect(await canViewKey(avery, devonKey)).toBe(true);
    expect(await canViewKey(casey, devonKey)).toBe(false);
    await expect(removeInspiration(casey, avery.id, look.id)).rejects.toMatchObject({ status: 403 });
    expect(await removeInspiration(avery, avery.id, look.id)).toBe(key);
    expect(await inspirationContext(avery.id)).toBe("");
  });
});

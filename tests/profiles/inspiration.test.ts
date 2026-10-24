import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
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
    const [jeff, brittney, olivia, mya] = await Promise.all([by("Jeff"), by("Brittney"), by("Olivia"), by("Mya")]);
    const key = newKey("inspo", jeff.id, "image/jpeg"); await putObject(key, await jpeg(), "image/jpeg");
    await expect(addInspiration(olivia, jeff.id, key)).rejects.toMatchObject({ status: 403 });
    const bodyKey = newKey("bodies", jeff.id, "image/jpeg");
    await expect(addInspiration(jeff, jeff.id, bodyKey)).rejects.toMatchObject({ status: 403 }); // wrong kind
    const look = await addInspiration(jeff, jeff.id, key);
    expect(look.notes.words).toContain("minimal");
    expect((await listInspiration(jeff.id)).length).toBe(1);
    const ctx = await inspirationContext(jeff.id);
    expect(ctx).toContain("Inspiration board (1 saved looks");
    expect(ctx).toContain("camel + black");
    expect(await styleContext(jeff.id)).toContain("Inspiration board");
    // private: Jeff's inspiration is Jeff's; a minor's is hers and her parents'
    expect(await canViewKey(jeff, key)).toBe(true);
    expect(await canViewKey(brittney, key)).toBe(false);
    const myaKey = newKey("inspo", mya.id, "image/jpeg"); await putObject(myaKey, await jpeg(), "image/jpeg");
    await addInspiration(jeff, mya.id, myaKey); // parent may add for a minor
    expect(await canViewKey(mya, myaKey)).toBe(true);
    expect(await canViewKey(jeff, myaKey)).toBe(true);
    expect(await canViewKey(olivia, myaKey)).toBe(false);
    await expect(removeInspiration(olivia, jeff.id, look.id)).rejects.toMatchObject({ status: 403 });
    expect(await removeInspiration(jeff, jeff.id, look.id)).toBe(key);
    expect(await inspirationContext(jeff.id)).toBe("");
  });
});

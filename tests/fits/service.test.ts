import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { personalClosetId } from "@/lib/items/service";
import { newKey, putObject } from "@/lib/storage";
import { canViewKey } from "@/lib/photos/visibility";
import { deleteFit, getDay, getFit, listMonth, saveFit, setFitPhoto, setFitViewers, wearHistory } from "@/lib/fits/service";

async function addItem(ownerId: string, name: string, category: string) {
  const cat = await db.category.findFirstOrThrow({ where: { name: category } });
  return db.item.create({ data: { ownerId, name, categoryId: cat.id, closets: { create: [{ closetId: await personalClosetId(ownerId) }] } } });
}

describe("fits", () => {
  beforeEach(async () => {
    await resetDb(); process.env.MOCK_S3 = "true"; process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-fits-")); await seed();
  });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });

  it("save, share, photo, visibility line, family month view, delete undoes wear", async () => {
    const [jeff, brittney, olivia, mya] = await Promise.all([by("Jeff"), by("Brittney"), by("Olivia"), by("Mya")]);
    const top = await addItem(jeff.id, "Black top", "Tops");
    const boots = await addItem(jeff.id, "Boots", "Shoes");
    const fitId = await saveFit(jeff, jeff.id, "2026-10-17", [top.id, boots.id], "Dinner out");
    await expect(saveFit(olivia, jeff.id, "2026-10-17", [top.id], "x")).rejects.toMatchObject({ status: 403 });
    let f = (await getFit(jeff, fitId))!;
    expect(f).toMatchObject({ title: "Dinner out", visibility: "Visible to Jeff only", canEdit: true });
    expect(f.pieces.map((p) => p.name)).toEqual(["Black top", "Boots"]);
    expect(await getFit(olivia, fitId)).toBeNull();
    await setFitViewers(jeff, fitId, [brittney.id, olivia.id]);
    f = (await getFit(olivia, fitId))!;
    expect(f.visibility).toBe("Visible to Jeff, Brittney, Olivia only");
    expect(f.canEdit).toBe(false);
    const key = newKey("fits", jeff.id, "image/jpeg");
    await putObject(key, Buffer.from("x"), "image/jpeg");
    await setFitPhoto(jeff, fitId, key);
    expect(await canViewKey(olivia, key)).toBe(true);
    expect(await canViewKey(mya, key)).toBe(false);
    await expect(setFitPhoto(jeff, fitId, newKey("fits", olivia.id, "image/jpeg"))).rejects.toMatchObject({ status: 400 });
    // family month view: Brittney sees Jeff's shared fit; Mya's own fit is seen by her parents, not Olivia
    const myaTop = await addItem(mya.id, "Mya top", "Tops");
    const myaFit = await saveFit(jeff, mya.id, "2026-10-18", [myaTop.id], "School");
    expect((await getFit(jeff, myaFit))!.visibility).toBe("Visible to Mya, Jeff, Brittney only");
    expect((await listMonth(brittney, { kind: "family" }, 2026, 9)).map((d) => `${d.date}:${d.ownerName}`)).toEqual(["2026-10-17:Jeff", "2026-10-18:Mya"]);
    expect((await listMonth(olivia, { kind: "family" }, 2026, 9)).map((d) => d.ownerName)).toEqual(["Jeff"]);
    expect((await getDay(olivia, { kind: "family" }, "2026-10-18"))).toEqual([]);
    expect((await wearHistory(top.id))[0]).toMatchObject({ wornOn: "2026-10-17", title: "Dinner out" });
    expect((await db.item.findUniqueOrThrow({ where: { id: top.id } })).wearCount).toBe(1);
    await deleteFit(jeff, fitId);
    expect(await getFit(jeff, fitId)).toBeNull();
    expect((await db.item.findUniqueOrThrow({ where: { id: top.id } }))).toMatchObject({ wearCount: 0, lastWornAt: null });
  });
});

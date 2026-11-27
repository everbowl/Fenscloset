import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { personalClosetId } from "@/lib/items/service";
import { newKey, putObject } from "@/lib/storage";
import { canViewKey } from "@/lib/photos/visibility";
import { deleteFit, getDay, getFit, listMonth, saveFit, setFitPhoto, setFitViewers, wearHistory } from "@/lib/fits/service";
import { dayKey, hourIn } from "@/lib/dates";

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
    const [avery, blake, casey, devon] = await Promise.all([by("Avery"), by("Blake"), by("Casey"), by("Devon")]);
    const top = await addItem(avery.id, "Black top", "Tops");
    const boots = await addItem(avery.id, "Boots", "Shoes");
    const fitId = await saveFit(avery, avery.id, "2026-10-17", [top.id, boots.id], "Dinner out");
    await expect(saveFit(casey, avery.id, "2026-10-17", [top.id], "x")).rejects.toMatchObject({ status: 403 });
    let f = (await getFit(avery, fitId))!;
    expect(f).toMatchObject({ title: "Dinner out", visibility: "Visible to Avery only", canEdit: true });
    expect(f.pieces.map((p) => p.name)).toEqual(["Black top", "Boots"]);
    expect(await getFit(casey, fitId)).toBeNull();
    await setFitViewers(avery, fitId, [blake.id, casey.id]);
    f = (await getFit(casey, fitId))!;
    expect(f.visibility).toBe("Visible to Avery, Blake, Casey only");
    expect(f.canEdit).toBe(false);
    const key = newKey("fits", avery.id, "image/jpeg");
    await putObject(key, Buffer.from("x"), "image/jpeg");
    await setFitPhoto(avery, fitId, key);
    expect(await canViewKey(casey, key)).toBe(true);
    expect(await canViewKey(devon, key)).toBe(false);
    await expect(setFitPhoto(avery, fitId, newKey("fits", casey.id, "image/jpeg"))).rejects.toMatchObject({ status: 400 });
    // family month view: Blake sees Avery's shared fit; Devon's own fit is seen by her parents, not Casey
    const devonTop = await addItem(devon.id, "Devon top", "Tops");
    const devonFit = await saveFit(avery, devon.id, "2026-10-18", [devonTop.id], "School");
    expect((await getFit(avery, devonFit))!.visibility).toBe("Visible to Devon, Avery, Blake only");
    expect((await listMonth(blake, { kind: "family" }, 2026, 9)).map((d) => `${d.date}:${d.ownerName}`)).toEqual(["2026-10-17:Avery", "2026-10-18:Devon"]);
    expect((await listMonth(casey, { kind: "family" }, 2026, 9)).map((d) => d.ownerName)).toEqual(["Avery"]);
    expect((await getDay(casey, { kind: "family" }, "2026-10-18"))).toEqual([]);
    expect((await wearHistory(top.id))[0]).toMatchObject({ wornOn: "2026-10-17", title: "Dinner out" });
    const worn = await db.item.findUniqueOrThrow({ where: { id: top.id } });
    expect(worn.wearCount).toBe(1);
    // a fit saved for a past day rests its pieces from that day, at local noon in the household zone (review D 2.3)
    expect(dayKey(worn.lastWornAt!, "America/Los_Angeles")).toBe("2026-10-17");
    expect(hourIn(worn.lastWornAt!, "America/Los_Angeles")).toBe(12);
    // removing a fit falls back to the earlier wear's day, never UTC midnight (review D 2.4/6.4)
    const earlier = await saveFit(avery, avery.id, "2026-10-15", [top.id], "Earlier");
    await deleteFit(avery, fitId);
    expect(await getFit(avery, fitId)).toBeNull();
    const back = await db.item.findUniqueOrThrow({ where: { id: top.id } });
    expect(back.wearCount).toBe(1);
    expect(dayKey(back.lastWornAt!, "America/Los_Angeles")).toBe("2026-10-15");
    await deleteFit(avery, earlier);
    expect((await db.item.findUniqueOrThrow({ where: { id: top.id } }))).toMatchObject({ wearCount: 0, lastWornAt: null });
  });
});

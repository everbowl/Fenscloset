import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { personalClosetId } from "@/lib/items/service";
import { getGoWith, goWith, latestGoWith, startGoWith } from "@/lib/shop/go-with";
import { forgetJobs, settled } from "@/lib/jobs";

async function addItem(ownerId: string, name: string, category: string, color?: string) {
  const cat = await db.category.findFirstOrThrow({ where: { name: category } });
  const col = color ? await db.color.findFirstOrThrow({ where: { name: color } }) : null;
  return db.item.create({ data: { ownerId, name, categoryId: cat.id, closets: { create: [{ closetId: await personalClosetId(ownerId) }] }, ...(col ? { colors: { connect: [{ id: col.id }] } } : {}) } });
}

describe("shop for something to go with a piece", () => {
  beforeEach(async () => {
    await resetDb(); forgetJobs();
    process.env.MOCK_S3 = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_FETCH = "true"; process.env.MOCK_SERPER = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-gowith-")); await seed();
  });
  const by = (name: string) => db.person.findFirstOrThrow({ where: { name } });

  it("what would complete the piece, products for it with the favorite store first, looks from the closet with the piece first; today's answer is reused, a new ask is fresh; only who may shop for the owner; the job path", async () => {
    const [jeff, olivia, mya] = await Promise.all([by("Jeff"), by("Olivia"), by("Mya")]);
    const jeans = await addItem(jeff.id, "Dark jeans", "Bottoms", "Navy");
    await addItem(jeff.id, "White tee", "Tops", "White");
    const nordstrom = await db.store.findFirst({ where: { name: "Nordstrom" } });
    if (nordstrom) await db.person.update({ where: { id: jeff.id }, data: { favoriteStores: { connect: [{ id: nordstrom.id }] } } });
    const steps: string[] = [];
    const v = await goWith(jeff, jeans.id, { step: (s) => steps.push(s) });
    expect(steps).toEqual(["Looking at the closet…", "Deciding what would complete it…", "Searching the stores…"]);
    expect(v.piece.name).toBe("Dark jeans");
    expect(v.forName).toBe("Jeff");
    expect(v.needCategory).toBe("Tops"); // the mock: a top for a bottom
    expect(v.queries.length).toBeGreaterThan(0);
    expect(v.products.length).toBeGreaterThan(0);
    if (nordstrom) expect(v.products[0].storeName).toBe("Nordstrom");
    expect(v.closetLooks.length).toBeGreaterThan(0);
    expect(v.closetLooks[0].pieces[0].id).toBe(jeans.id);
    // reused within the day; asked again, a fresh row
    expect((await latestGoWith(jeff, jeans.id))?.id).toBe(v.id);
    const again = await goWith(jeff, jeans.id);
    expect(again.id).not.toBe(v.id);
    expect((await latestGoWith(jeff, jeans.id))?.id).toBe(again.id);
    // Olivia may not shop for Jeff: no answer, no run
    expect(await getGoWith(olivia, v.id)).toBeNull();
    await expect(goWith(olivia, jeans.id)).rejects.toMatchObject({ status: 403 });
    // Jeff, a parent, may shop for Mya; the background job's result is the row's id
    const myaTee = await addItem(mya.id, "Mya tee", "Tops", "White");
    const job = startGoWith(jeff, myaTee.id);
    expect(startGoWith(jeff, myaTee.id)).toBe(job);
    const done = await settled(job, 15_000);
    expect(done.state).toBe("done");
    const forMya = await getGoWith(jeff, (done as { state: "done"; result: string }).result);
    expect(forMya?.forName).toBe("Mya");
    expect(forMya?.needCategory).toBe("Bottoms");
    // a piece that is gone
    await expect(goWith(jeff, "nope")).rejects.toMatchObject({ status: 404 });
  });
});

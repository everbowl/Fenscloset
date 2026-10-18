import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { createEntry, listEntries, updateEntry } from "@/lib/lists/service";
import { GENERAL_TIPS, getAddTips, setAddTipsHidden } from "@/lib/tips";

describe("photo tips", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("seeds a tip per category without overwriting admin edits; tips are editable like any list field", async () => {
    const shoes = (await listEntries("category")).find((c) => c.name === "Shoes")!;
    expect(shoes.photoTip).toMatch(/toes toward you/);
    await updateEntry("category", shoes.id, { photoTip: "  Shoot the pair from the side.  " });
    expect((await listEntries("category")).find((c) => c.name === "Shoes")!.photoTip).toBe("Shoot the pair from the side.");
    await seed(); // the start command re-seeds on every deploy: edits must survive
    expect((await listEntries("category")).find((c) => c.name === "Shoes")!.photoTip).toBe("Shoot the pair from the side.");
    await updateEntry("category", shoes.id, { photoTip: "" });
    expect((await listEntries("category")).find((c) => c.name === "Shoes")!.photoTip).toBeNull();
    const scarves = await createEntry("category", { name: "Scarves", photoTip: "Fold once, lay flat." });
    expect(scarves.photoTip).toBe("Fold once, lay flat.");
  });

  it("the Add page gets the general rules plus every category that has a tip; each person can hide and restore it", async () => {
    const jeff = await db.person.findFirstOrThrow({ where: { name: "Jeff" } });
    const mya = await db.person.findFirstOrThrow({ where: { name: "Mya" } });
    const tips = await getAddTips(jeff.id);
    expect(tips.hidden).toBe(false);
    expect(tips.general).toEqual(GENERAL_TIPS);
    expect(tips.categories.map((c) => c.name)).toContain("Tops");
    expect(tips.categories.every((c) => c.tip.length > 0)).toBe(true);
    await setAddTipsHidden(jeff, true);
    expect((await getAddTips(jeff.id)).hidden).toBe(true);
    expect((await getAddTips(mya.id)).hidden).toBe(false); // per person
    await setAddTipsHidden(jeff, false);
    expect((await getAddTips(jeff.id)).hidden).toBe(false);
  });
});

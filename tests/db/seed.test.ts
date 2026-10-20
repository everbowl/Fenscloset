import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { applySeedSets, seed } from "../../prisma/seed";
import { verifyPassword } from "@/lib/auth/password";

describe("seed", () => {
  beforeEach(resetDb);

  it("is idempotent and seeds the family, closets, lists and rules", async () => {
    process.env.DEV_MODE = "true";
    await seed();
    const first = {
      people: await db.person.count(), closets: await db.closet.count(), cats: await db.category.count(),
      subs: await db.subcategory.count(), colors: await db.color.count(), rules: await db.rule.count(),
      scales: await db.checkInScale.count(), options: await db.checkInOption.count(),
    };
    await seed();
    const second = {
      people: await db.person.count(), closets: await db.closet.count(), cats: await db.category.count(),
      subs: await db.subcategory.count(), colors: await db.color.count(), rules: await db.rule.count(),
      scales: await db.checkInScale.count(), options: await db.checkInOption.count(),
    };
    expect(second).toEqual(first);
    expect(first.people).toBe(4);
    expect(first.closets).toBe(5); // 4 personal + Family
    expect(first.scales).toBe(3);
    expect(first.rules).toBe(13); // 3 originals + 8 size-band rules + button color + mirror engine
    // a rule that left the code (the Tidy and Smooth switch) is removed on the next deploy
    await db.rule.create({ data: { key: "photoRetouch", value: "off", label: "AI photo retouch", description: "gone" } });
    await seed();
    expect(await db.rule.findUnique({ where: { key: "photoRetouch" } })).toBeNull();
    expect(await db.rule.count()).toBe(13);

    const mya = await db.person.findFirstOrThrow({ where: { name: "Mya" }, include: { guardians: true } });
    expect(mya.role).toBe("minor");
    expect(mya.guardians.map((g) => g.parentId).sort()).toHaveLength(2);
    const olivia = await db.person.findFirstOrThrow({ where: { name: "Olivia" } });
    expect(olivia.role).toBe("member");
  });

  it("gives Jeff the one-time 0535 password only in DEV mode", async () => {
    process.env.DEV_MODE = "true";
    await seed();
    let jeff = await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } });
    expect(jeff.devPasswordActive).toBe(true);
    expect(jeff.mustChangePassword).toBe(true);
    expect(await verifyPassword(jeff.passwordHash!, "0535")).toBe(true);

    await resetDb();
    process.env.DEV_MODE = "false";
    await seed();
    jeff = await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } });
    expect(jeff.passwordHash).toBeNull();
    expect(jeff.devPasswordActive).toBe(false);
  });
});

describe("seed guard", () => {
  it("does nothing on a database that already has people unless SEED_FORCE is set", async () => {
    await resetDb();
    process.env.DEV_MODE = "true";
    process.env.SEED_FORCE = "true";
    await seed();
    await db.brand.deleteMany({ where: { name: "Nike" } });
    delete process.env.SEED_FORCE;
    await seed();
    expect(await db.brand.count({ where: { name: "Nike" } })).toBe(0); // admin's deletion survives a deploy
    process.env.SEED_FORCE = "true";
    await seed();
    expect(await db.brand.count({ where: { name: "Nike" } })).toBe(1);
  });

  it("additive seed sets land once on a database that already has people, and never re-create what was removed after", async () => {
    await seed();
    expect(await db.seedSet.count()).toBe(9);
    expect(await db.brand.count()).toBeGreaterThan(150); // the national catalog is in the Brands list
    // the mirror's styling lists: untucked first, poses with "as photographed" first
    expect((await db.mirrorPose.findMany({ orderBy: { sortOrder: "asc" } }))[0].name).toBe("Standing, as photographed");
    expect(await db.wearGroup.count()).toBe(7);
    const tuck = await db.wearGroup.findUniqueOrThrow({ where: { name: "Tuck" }, include: { options: { orderBy: { sortOrder: "asc" } } } });
    expect(tuck.needs).toBe("top bottom");
    expect(tuck.options[0]).toMatchObject({ name: "Untucked" });
    expect(tuck.options[0].prompt).toMatch(/untucked/);
    expect((await db.brand.findFirstOrThrow({ where: { name: "Patagonia" } })).url).toBe("https://www.patagonia.com");
    // simulate a database seeded before Cup size existed
    await db.measurementKind.deleteMany({ where: { name: "Cup size" } });
    await db.seedSet.delete({ where: { name: "measurement-kinds-v2" } });
    delete process.env.SEED_FORCE;
    await seed(); // people exist → only the missing set runs
    expect(await db.measurementKind.count({ where: { name: "Cup size" } })).toBe(1);
    const kinds = await db.measurementKind.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true } });
    expect(kinds.map((k) => k.name).slice(0, 4)).toEqual(["Height", "Weight", "Chest / bust", "Cup size"]);
    // an admin removes it afterwards: the next deploy leaves it removed
    await db.measurementKind.deleteMany({ where: { name: "Cup size" } });
    expect(await applySeedSets()).toEqual([]);
    expect(await db.measurementKind.count({ where: { name: "Cup size" } })).toBe(0);
    // shoes: a database seeded with plain numbers gets M / W side by side once
    const shoes = await db.category.findUniqueOrThrow({ where: { name: "Shoes" } });
    await db.sizeOption.create({ data: { categoryId: shoes.id, name: "10", sortOrder: 99 } });
    await db.seedSet.delete({ where: { name: "shoe-sizes-v2" } });
    await seed();
    const names = (await db.sizeOption.findMany({ where: { categoryId: shoes.id }, orderBy: { sortOrder: "asc" } })).map((o) => o.name);
    expect(names).toContain("M 10 / W 11.5");
    expect(names).not.toContain("10");
  });
});

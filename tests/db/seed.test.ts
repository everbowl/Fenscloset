import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb, seed } from "../helpers";
import { applySeedSets, seed as seedDefaults } from "../../prisma/seed";
import { seedPeople } from "../fixtures/people";

describe("seed", () => {
  beforeEach(resetDb);

  it("an empty database seeds no people: the lists, rules and the Family closet, idempotently", async () => {
    await seedDefaults();
    const count = async () => ({
      people: await db.person.count(), closets: await db.closet.count(), cats: await db.category.count(),
      subs: await db.subcategory.count(), colors: await db.color.count(), rules: await db.rule.count(),
      scales: await db.checkInScale.count(), options: await db.checkInOption.count(), guardians: await db.guardianLink.count(),
      approvals: await db.minorBodyImageApproval.count(),
    });
    const first = await count();
    await seedDefaults();
    expect(await count()).toEqual(first);
    expect(first.people).toBe(0); // security item 1: no one's name or address lives in the repository
    expect(first.guardians).toBe(0);
    expect(first.approvals).toBe(0);
    expect(first.closets).toBe(1); // the Family closet only
    expect((await db.closet.findFirstOrThrow()).kind).toBe("family");
    expect(first.scales).toBe(3);
    expect(first.rules).toBe(20); // 3 originals + the laundry cycle + the Not-now days + 8 size-band rules + button color + mirror engine + the Looking-for search interval + Compare's three switches + the household line
    // a rule that left the code (the Tidy and Smooth switch) is removed on the next deploy
    await db.rule.create({ data: { key: "photoRetouch", value: "off", label: "AI photo retouch", description: "gone" } });
    await seedDefaults();
    expect(await db.rule.findUnique({ where: { key: "photoRetouch" } })).toBeNull();
    expect(await db.rule.count()).toBe(20);
  });

  it("FC_BOOTSTRAP_ADMIN_EMAIL on an empty database creates one admin with no password, and nothing after that", async () => {
    process.env.FC_BOOTSTRAP_ADMIN_EMAIL = " First.Admin@Example.test ";
    try { await seedDefaults(); } finally { delete process.env.FC_BOOTSTRAP_ADMIN_EMAIL; }
    const people = await db.person.findMany();
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ email: "first.admin@example.test", role: "admin", status: "invited", passwordHash: null });
    expect(await db.closet.count({ where: { ownerId: people[0].id, kind: "personal" } })).toBe(1);
    await seedDefaults(); // the variable is gone and people exist: nobody else is created
    expect(await db.person.count()).toBe(1);
  });
});

describe("seed guard", () => {
  it("does nothing on a database that already has people unless SEED_FORCE is set", async () => {
    await resetDb();
    process.env.SEED_FORCE = "true";
    await seedDefaults();
    await seedPeople();
    await db.brand.deleteMany({ where: { name: "Nike" } });
    delete process.env.SEED_FORCE;
    await seedDefaults();
    expect(await db.brand.count({ where: { name: "Nike" } })).toBe(0); // admin's deletion survives a deploy
    process.env.SEED_FORCE = "true";
    await seedDefaults();
    expect(await db.brand.count({ where: { name: "Nike" } })).toBe(1);
  });

  it("additive seed sets land once on a database that already has people, and never re-create what was removed after", async () => {
    await seed();
    expect(await db.seedSet.count()).toBe(10);
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
    await seedDefaults(); // people exist → only the missing set runs
    expect(await db.measurementKind.count({ where: { name: "Cup size" } })).toBe(1);
    const kinds = await db.measurementKind.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true } });
    expect(kinds.map((k) => k.name).slice(0, 4)).toEqual(["Height", "Weight", "Chest / bust", "Cup size"]);
    // an admin removes it afterwards: the next deploy leaves it removed
    await db.measurementKind.deleteMany({ where: { name: "Cup size" } });
    expect(await applySeedSets()).toEqual([]);
    expect(await db.measurementKind.count({ where: { name: "Cup size" } })).toBe(0);
    // shop sections (2 Nov 2026): a database from before gets the list once; nobody is put in a section by the seed; a section an admin removed stays removed
    await db.person.updateMany({ data: { shopSectionId: null } });
    await db.shopSection.deleteMany({});
    await db.seedSet.delete({ where: { name: "shop-sections-v1" } });
    await seedDefaults();
    expect((await db.shopSection.findMany({ orderBy: { sortOrder: "asc" } })).map((x) => x.name)).toEqual(["Men's", "Women's", "Boys'", "Girls'", "Unisex"]);
    expect(await db.person.count({ where: { shopSectionId: { not: null } } })).toBe(0);
    await db.shopSection.delete({ where: { name: "Unisex" } });
    expect(await applySeedSets()).toEqual([]);
    expect(await db.shopSection.count()).toBe(4);
    // shoes: a database seeded with plain numbers gets M / W side by side once
    const shoes = await db.category.findUniqueOrThrow({ where: { name: "Shoes" } });
    await db.sizeOption.create({ data: { categoryId: shoes.id, name: "10", sortOrder: 99 } });
    await db.seedSet.delete({ where: { name: "shoe-sizes-v2" } });
    await seedDefaults();
    const names = (await db.sizeOption.findMany({ where: { categoryId: shoes.id }, orderBy: { sortOrder: "asc" } })).map((o) => o.name);
    expect(names).toContain("M 10 / W 11.5");
    expect(names).not.toContain("10");
  });
});

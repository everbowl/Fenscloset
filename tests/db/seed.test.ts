import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
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
    expect(first.rules).toBe(3);

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
});

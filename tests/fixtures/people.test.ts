import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { DEV_PASSWORD } from "../../prisma/seed-data";
import { resetDb } from "../helpers";
import { seed as seedDefaults } from "../../prisma/seed";
import { FIXTURE_ADMIN_EMAIL, FIXTURE_PEOPLE, seedPeople } from "./people";

describe("the synthetic household", () => {
  beforeEach(async () => { await resetDb(); process.env.DEV_MODE = "true"; await seedDefaults(); });

  it("is four invented people with example.test addresses only, a minor with two guardians, a closet each, and is idempotent", async () => {
    const ids = await seedPeople();
    await seedPeople();
    expect(await db.person.count()).toBe(4);
    for (const p of await db.person.findMany()) expect(p.email === null || p.email.endsWith("@example.test")).toBe(true);
    const minor = await db.person.findUniqueOrThrow({ where: { id: ids.minor }, include: { guardians: true } });
    expect(minor.role).toBe("minor");
    expect(minor.guardians.map((g) => g.parentId).sort()).toEqual([ids.admin, ids.parent].sort());
    expect((await db.person.findUniqueOrThrow({ where: { id: ids.adult } })).role).toBe("member");
    expect(await db.closet.count()).toBe(5); // 4 personal + Family
    expect(await db.closet.count({ where: { kind: "personal" } })).toBe(4);
    expect((await db.minorBodyImageApproval.findUniqueOrThrow({ where: { minorId: ids.minor } })).approvedById).toBe(ids.admin);
    expect((await db.person.findUniqueOrThrow({ where: { id: ids.admin }, include: { shopSection: true } })).shopSection?.name).toBe("Men's");
    expect(Object.values(FIXTURE_PEOPLE).map((p) => p.name)).toEqual(["Avery", "Blake", "Casey", "Devon"]);
  });

  it("gives the first admin the one-time dev password only in DEV mode (until security item 3 removes that path)", async () => {
    await seedPeople();
    let admin = await db.person.findUniqueOrThrow({ where: { email: FIXTURE_ADMIN_EMAIL } });
    expect(admin.devPasswordActive).toBe(true);
    expect(admin.mustChangePassword).toBe(true);
    expect(await verifyPassword(admin.passwordHash!, DEV_PASSWORD)).toBe(true);

    await resetDb();
    process.env.DEV_MODE = "false";
    await seedDefaults();
    await seedPeople();
    admin = await db.person.findUniqueOrThrow({ where: { email: FIXTURE_ADMIN_EMAIL } });
    expect(admin.passwordHash).toBeNull();
    expect(admin.devPasswordActive).toBe(false);
  });
});

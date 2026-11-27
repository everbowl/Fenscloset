import { db } from "../../src/lib/db";
import { hashPassword } from "../../src/lib/auth/password";
import { isDevMode } from "../../src/lib/auth/dev-mode";
import { DEV_PASSWORD } from "../../prisma/seed-data";
import { FIXTURE_PEOPLE, type FixturePerson } from "./people-data";

export { FIXTURE_ADMIN_EMAIL, FIXTURE_ADMIN_PASSWORD, FIXTURE_PEOPLE } from "./people-data";

/**
 * Creates the synthetic household the way the seed used to create the real one: people (status invited), guardian links,
 * a personal closet each, the minor's body-image approval by the first admin, and the first admin shopping the first store
 * section. In DEV mode the first admin gets the one-time dev password exactly as the seed did, so the sign-in flow is still
 * covered until that path is removed (security item 3). Idempotent: an existing person is reused, never duplicated.
 */
export async function seedPeople(opts: { approveMinorBodyImages?: boolean } = {}): Promise<Record<FixturePerson["key"], string>> {
  const ids = {} as Record<FixturePerson["key"], string>;
  for (const p of Object.values(FIXTURE_PEOPLE)) {
    const existing = p.email
      ? await db.person.findUnique({ where: { email: p.email } })
      : await db.person.findFirst({ where: { name: p.name, email: null } });
    const person = existing
      ? await db.person.update({ where: { id: existing.id }, data: { role: p.role } })
      : await db.person.create({ data: { name: p.name, email: p.email, role: p.role, status: "invited" } });
    ids[p.key] = person.id;
  }

  const admin = await db.person.findUniqueOrThrow({ where: { id: ids.admin } });
  if (isDevMode() && !admin.passwordHash) {
    await db.person.update({
      where: { id: admin.id },
      data: { passwordHash: await hashPassword(DEV_PASSWORD), mustChangePassword: true, devPasswordActive: true, status: "active" },
    });
  }

  for (const p of Object.values(FIXTURE_PEOPLE)) {
    for (const g of p.guardians ?? []) {
      await db.guardianLink.upsert({
        where: { minorId_parentId: { minorId: ids[p.key], parentId: ids[g] } },
        update: {},
        create: { minorId: ids[p.key], parentId: ids[g] },
      });
    }
    const closet = await db.closet.findFirst({ where: { ownerId: ids[p.key], kind: "personal" } });
    if (!closet) await db.closet.create({ data: { name: `${p.name}'s closet`, kind: "personal", ownerId: ids[p.key] } });
  }
  if (!(await db.closet.findFirst({ where: { kind: "family" } }))) await db.closet.create({ data: { name: "Family", kind: "family", sortOrder: 100 } });

  if (opts.approveMinorBodyImages ?? true) {
    await db.minorBodyImageApproval.upsert({ where: { minorId: ids.minor }, update: {}, create: { minorId: ids.minor, approvedById: ids.admin } });
  }

  const firstSection = await db.shopSection.findFirst({ orderBy: { sortOrder: "asc" } });
  if (firstSection) await db.person.updateMany({ where: { id: ids.admin, shopSectionId: null }, data: { shopSectionId: firstSection.id } });
  return ids;
}

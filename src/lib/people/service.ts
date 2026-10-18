import { db } from "@/lib/db";
import { destroyAllSessionsFor } from "@/lib/auth/session";
import { normalizeEmail } from "@/lib/auth/login";
import { normalizePhone } from "@/lib/sms";
import type { Role } from "@/generated/prisma/client";

export type PersonSummary = {
  id: string; name: string; email: string | null; phone: string | null; role: Role; status: "active" | "invited" | "removed";
  birthdate: Date | null; guardianIds: string[]; hasPassword: boolean; devPasswordActive: boolean;
  pendingInvite: boolean;
};

export async function listPeople(opts: { includeRemoved?: boolean } = {}): Promise<PersonSummary[]> {
  const people = await db.person.findMany({
    where: opts.includeRemoved ? {} : { status: { not: "removed" } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    include: { guardians: true },
  });
  const pending = await db.inviteToken.findMany({ where: { acceptedAt: null, expiresAt: { gt: new Date() } }, select: { acceptedPersonId: true } });
  const pendingIds = new Set(pending.map((p) => p.acceptedPersonId));
  return people.map((p) => ({
    id: p.id, name: p.name, email: p.email, phone: p.phone, role: p.role, status: p.status, birthdate: p.birthdate,
    guardianIds: p.guardians.map((g) => g.parentId), hasPassword: Boolean(p.passwordHash), devPasswordActive: p.devPasswordActive,
    pendingInvite: pendingIds.has(p.id),
  }));
}

export async function getPerson(id: string): Promise<PersonSummary | null> {
  const all = await listPeople({ includeRemoved: true });
  return all.find((p) => p.id === id) ?? null;
}

export async function updatePersonDetails(id: string, data: { name?: string; email?: string | null; phone?: string | null; birthdate?: Date | null; savedZip?: string | null }) {
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) { const n = data.name.trim(); if (!n) throw new Error("Name can't be blank."); patch.name = n; }
  if (data.email !== undefined) patch.email = data.email ? normalizeEmail(data.email) : null;
  if (data.phone !== undefined) {
    if (data.phone) { const p = normalizePhone(data.phone); if (!p) throw new Error("That phone number doesn't look right."); patch.phone = p; } else patch.phone = null;
  }
  if (data.birthdate !== undefined) patch.birthdate = data.birthdate;
  if (data.savedZip !== undefined) patch.savedZip = data.savedZip;
  try {
    return await db.person.update({ where: { id }, data: patch });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new Error("That email is already used by someone else.");
    throw e;
  }
}

/** Changing roles. Refuses to demote the last admin so nobody gets locked out. */
export async function setRole(id: string, role: Role): Promise<void> {
  const person = await db.person.findUniqueOrThrow({ where: { id } });
  if (person.role === "admin" && role !== "admin") {
    const admins = await db.person.count({ where: { role: "admin", status: { not: "removed" }, NOT: { id } } });
    if (admins === 0) throw new Error("There has to be at least one admin.");
  }
  await db.person.update({ where: { id }, data: { role } });
  if (role !== "minor") await db.guardianLink.deleteMany({ where: { minorId: id } });
}

export async function setGuardians(minorId: string, parentIds: string[]): Promise<void> {
  const minor = await db.person.findUniqueOrThrow({ where: { id: minorId } });
  if (minor.role !== "minor") throw new Error("Only minors have parent admins.");
  const parents = await db.person.findMany({ where: { id: { in: parentIds }, role: "admin", status: { not: "removed" } } });
  if (parents.length === 0) throw new Error("Pick at least one parent admin.");
  await db.$transaction(async (tx) => {
    await tx.guardianLink.deleteMany({ where: { minorId } });
    for (const p of parents) await tx.guardianLink.create({ data: { minorId, parentId: p.id } });
  });
}

/**
 * Removes a person. Their items are deleted or moved to the Family closet (ownership transfers to the
 * removing admin so nothing is orphaned). Sessions are revoked; the record is kept as `removed`.
 */
export async function removePerson(id: string, opts: { items: "delete" | "moveToFamily"; byAdminId: string }): Promise<{ movedItems: number; deletedItems: number }> {
  const person = await db.person.findUniqueOrThrow({ where: { id } });
  if (person.role === "admin") {
    const admins = await db.person.count({ where: { role: "admin", status: { not: "removed" }, NOT: { id } } });
    if (admins === 0) throw new Error("You can't remove the last admin.");
  }
  if (id === opts.byAdminId) throw new Error("You can't remove yourself.");
  let movedItems = 0, deletedItems = 0;
  await db.$transaction(async (tx) => {
    if (opts.items === "delete") {
      deletedItems = (await tx.item.deleteMany({ where: { ownerId: id } })).count;
    } else {
      const family = await tx.closet.findFirstOrThrow({ where: { kind: "family" } });
      const items = await tx.item.findMany({ where: { ownerId: id }, select: { id: true } });
      movedItems = items.length;
      await tx.item.updateMany({ where: { ownerId: id }, data: { ownerId: opts.byAdminId } });
      await tx.itemCloset.deleteMany({ where: { itemId: { in: items.map((i) => i.id) } } });
      for (const i of items) await tx.itemCloset.create({ data: { itemId: i.id, closetId: family.id } });
    }
    await tx.closet.deleteMany({ where: { ownerId: id } });
    await tx.guardianLink.deleteMany({ where: { OR: [{ minorId: id }, { parentId: id }] } });
    await tx.inviteToken.updateMany({ where: { acceptedPersonId: id, acceptedAt: null }, data: { expiresAt: new Date() } });
    await tx.person.update({ where: { id }, data: { status: "removed", passwordHash: null, devPasswordActive: false, email: person.email ? `removed+${person.id}@${person.email.split("@")[1]}` : null } });
  });
  await destroyAllSessionsFor(id);
  return { movedItems, deletedItems };
}

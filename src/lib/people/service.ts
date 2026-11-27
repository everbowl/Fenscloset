import { db } from "@/lib/db";
import { destroyAllSessionsFor } from "@/lib/auth/session";
import { hasUsablePassword, normalizeEmail } from "@/lib/auth/login";
import { normalizePhone } from "@/lib/sms";
import { deleteObject } from "@/lib/storage";
import type { Role } from "@/generated/prisma/client";

export type PersonSummary = {
  id: string; name: string; email: string | null; phone: string | null; role: Role; status: "active" | "invited" | "removed";
  birthdate: Date | null; guardianIds: string[]; hasPassword: boolean;
  pendingInvite: boolean;
};

export async function listPeople(opts: { includeRemoved?: boolean } = {}): Promise<PersonSummary[]> {
  const [people, pending] = await Promise.all([
    db.person.findMany({
      where: opts.includeRemoved ? {} : { status: { not: "removed" } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: { guardians: true },
    }),
    db.inviteToken.findMany({ where: { acceptedAt: null, expiresAt: { gt: new Date() } }, select: { acceptedPersonId: true } }),
  ]);
  const pendingIds = new Set(pending.map((p) => p.acceptedPersonId));
  return people.map((p) => ({
    id: p.id, name: p.name, email: p.email, phone: p.phone, role: p.role, status: p.status, birthdate: p.birthdate,
    guardianIds: p.guardians.map((g) => g.parentId), hasPassword: hasUsablePassword(p),
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
  if (data.email !== undefined) {
    const next = data.email ? normalizeEmail(data.email) : null;
    const person = await db.person.findUniqueOrThrow({ where: { id }, select: { email: true, passwordHash: true } });
    // The email is how they sign in: it can change, but not vanish, while a password exists (review A W7).
    if (!next && person.passwordHash) throw new Error("They sign in with this email, so it can't be cleared. Change it instead.");
    patch.email = next;
  }
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

/** The active admins among `ids`, other than the person themself. */
async function parentAdmins(ids: string[], exceptId: string): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await db.person.findMany({ where: { id: { in: ids }, role: "admin", status: { not: "removed" }, NOT: { id: exceptId } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Changing roles. Refuses to demote the last admin so nobody gets locked out. Becoming a minor needs at least one parent
 * admin and drops every grant the person had handed out: a minor's body data and shopping stay with the minor and their
 * parents (review A S5).
 */
export async function setRole(id: string, role: Role, opts: { guardianIds?: string[] } = {}): Promise<void> {
  const person = await db.person.findUniqueOrThrow({ where: { id } });
  if (person.role === "admin" && role !== "admin") {
    const admins = await db.person.count({ where: { role: "admin", status: { not: "removed" }, NOT: { id } } });
    if (admins === 0) throw new Error("There has to be at least one admin.");
  }
  if (role === "minor") {
    const parents = await parentAdmins(opts.guardianIds ?? [], id);
    if (!parents.length) throw new Error("Pick at least one parent admin.");
    await db.$transaction([
      db.person.update({ where: { id }, data: { role } }),
      db.bodyDataGrant.deleteMany({ where: { ownerId: id } }),
      db.shopForGrant.deleteMany({ where: { ownerId: id } }),
      db.guardianLink.deleteMany({ where: { minorId: id } }),
      db.guardianLink.createMany({ data: parents.map((parentId) => ({ minorId: id, parentId })) }),
    ]);
    return;
  }
  await db.$transaction([
    db.person.update({ where: { id }, data: { role } }),
    db.guardianLink.deleteMany({ where: { minorId: id } }),
    db.minorBodyImageApproval.deleteMany({ where: { minorId: id } }),
  ]);
}

export async function setGuardians(minorId: string, parentIds: string[]): Promise<void> {
  const minor = await db.person.findUniqueOrThrow({ where: { id: minorId } });
  if (minor.role !== "minor") throw new Error("Only minors have parent admins.");
  const parents = await parentAdmins(parentIds, minorId);
  if (parents.length === 0) throw new Error("Pick at least one parent admin.");
  await db.$transaction([
    db.guardianLink.deleteMany({ where: { minorId } }),
    db.guardianLink.createMany({ data: parents.map((parentId) => ({ minorId, parentId })) }),
  ]);
}

/**
 * Removes a person. Their items are deleted or moved to the Family closet (ownership transfers to the removing admin so
 * nothing is orphaned). Sessions are revoked; the record is kept as `removed`. Their body (measurements, sizes, body
 * photos, check-in selfies, try-on pictures, inspiration shots) goes for good, bucket objects included (review A S6).
 */
export async function removePerson(id: string, opts: { items: "delete" | "moveToFamily"; byAdminId: string }): Promise<{ movedItems: number; deletedItems: number }> {
  const person = await db.person.findUniqueOrThrow({ where: { id } });
  if (person.role === "admin") {
    const admins = await db.person.count({ where: { role: "admin", status: { not: "removed" }, NOT: { id } } });
    if (admins === 0) throw new Error("You can't remove the last admin.");
  }
  if (id === opts.byAdminId) throw new Error("You can't remove yourself.");
  let movedItems = 0, deletedItems = 0;
  // Bucket keys to drop once the rows are gone; a bucket that is slow never holds the removal up.
  const [bodyPhotos, selfies, tryOns, inspo] = await Promise.all([
    db.bodyPhoto.findMany({ where: { personId: id }, select: { bucketKey: true } }),
    db.checkIn.findMany({ where: { personId: id, selfieKey: { not: null } }, select: { selfieKey: true } }),
    db.tryOn.findMany({ where: { personId: id }, select: { bucketKey: true } }),
    db.inspirationLook.findMany({ where: { personId: id }, select: { bucketKey: true } }),
  ]);
  const keys = [...bodyPhotos.map((p) => p.bucketKey), ...selfies.map((s) => s.selfieKey!), ...tryOns.map((t) => t.bucketKey), ...inspo.map((i) => i.bucketKey)];
  await db.$transaction(async (tx) => {
    if (opts.items === "delete") {
      deletedItems = (await tx.item.deleteMany({ where: { ownerId: id } })).count;
    } else {
      const family = await tx.closet.findFirstOrThrow({ where: { kind: "family" } });
      const items = await tx.item.findMany({ where: { ownerId: id }, select: { id: true } });
      movedItems = items.length;
      await tx.item.updateMany({ where: { ownerId: id }, data: { ownerId: opts.byAdminId } });
      await tx.itemCloset.deleteMany({ where: { itemId: { in: items.map((i) => i.id) } } });
      await tx.itemCloset.createMany({ data: items.map((i) => ({ itemId: i.id, closetId: family.id })) }); // one statement, not one per piece (review A P6)
    }
    await tx.closet.deleteMany({ where: { ownerId: id } });
    await tx.guardianLink.deleteMany({ where: { OR: [{ minorId: id }, { parentId: id }] } });
    await tx.bodyDataGrant.deleteMany({ where: { OR: [{ ownerId: id }, { viewerId: id }] } });
    await tx.shopForGrant.deleteMany({ where: { OR: [{ ownerId: id }, { shopperId: id }] } });
    await tx.minorBodyImageApproval.deleteMany({ where: { minorId: id } });
    await tx.bodyPhoto.deleteMany({ where: { personId: id } });
    await tx.bodyMeasurement.deleteMany({ where: { personId: id } });
    await tx.bodySizeByBrand.deleteMany({ where: { personId: id } });
    await tx.bodyProfile.deleteMany({ where: { personId: id } });
    await tx.checkIn.deleteMany({ where: { personId: id } });
    await tx.tryOn.deleteMany({ where: { personId: id } });
    await tx.inspirationLook.deleteMany({ where: { personId: id } });
    await tx.inviteToken.updateMany({ where: { acceptedPersonId: id, acceptedAt: null }, data: { expiresAt: new Date() } });
    await tx.person.update({ where: { id }, data: { status: "removed", passwordHash: null, email: person.email ? `removed+${person.id}@${person.email.split("@")[1]}` : null } });
  });
  await destroyAllSessionsFor(id);
  await Promise.all(keys.map((k) => deleteObject(k).catch(() => {})));
  return { movedItems, deletedItems };
}

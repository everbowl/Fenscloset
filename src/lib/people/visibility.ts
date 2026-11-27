import { cache } from "react";
import { db } from "@/lib/db";
import { VIEW_COOKIE } from "@/lib/auth/cookies";
import type { Person } from "@/generated/prisma/client";

export type Viewer = Pick<Person, "id" | "role">;
export type ClosetView = { kind: "person"; personId: string; name: string } | { kind: "family" };
export { VIEW_COOKIE };

/** Q13 A: any family member can browse any other member's closet, plus the Family closet. */
export async function viewableClosets(viewer: Viewer): Promise<{ key: string; label: string; personId?: string }[]> {
  const people = await db.person.findMany({ where: { status: { not: "removed" } }, orderBy: [{ role: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } });
  const self = people.find((p) => p.id === viewer.id);
  const others = people.filter((p) => p.id !== viewer.id);
  return [
    ...(self ? [{ key: self.id, label: self.name.split(" ")[0], personId: self.id }] : []),
    { key: "family", label: "Family" },
    ...others.map((p) => ({ key: p.id, label: p.name.split(" ")[0], personId: p.id })),
  ];
}

/**
 * Turns the fc_view cookie into a view, falling back to the viewer's own closet. The layout and the page both ask on
 * every request, so the answer is kept for the request (React cache; review A P3). A viewer with a `name` is trusted
 * for their own closet without another lookup.
 */
export const resolveView = cache(async (viewer: Viewer & { name?: string }, cookieValue: string | undefined): Promise<ClosetView> => {
  if (cookieValue === "family") return { kind: "family" };
  if (cookieValue && cookieValue !== viewer.id) {
    const p = await db.person.findUnique({ where: { id: cookieValue }, select: { id: true, name: true, status: true } });
    if (p && p.status !== "removed") return { kind: "person", personId: p.id, name: p.name.split(" ")[0] };
  }
  const name = viewer.name ?? (await db.person.findUniqueOrThrow({ where: { id: viewer.id }, select: { name: true } })).name;
  return { kind: "person", personId: viewer.id, name: name.split(" ")[0] };
});

/** Worn photos are item photos, visible to the family, except a minor's: minor + parents only. */
export async function canSeeWornPhoto(viewer: Viewer, owner: Viewer): Promise<boolean> {
  if (viewer.id === owner.id) return true;
  if (owner.role !== "minor") return true;
  return Boolean(await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: owner.id, parentId: viewer.id } } }));
}

/** Owners edit their own things; admins (the parents) can tidy anyone's closet. */
export function canEditItem(viewer: Viewer, ownerId: string): boolean {
  return viewer.id === ownerId || viewer.role === "admin";
}

// ---------- Body data, shopping, body photos (Phase 2) ----------

async function isParentOf(viewerId: string, ownerId: string): Promise<boolean> {
  return Boolean(await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: ownerId, parentId: viewerId } } }));
}

/** Body profile (measurements, sizes, fit notes, body photos): owner, parents of a minor, or an explicit grant. Admins get nothing automatically. */
export async function canSeeBodyData(viewer: Viewer, ownerId: string): Promise<boolean> {
  if (viewer.id === ownerId) return true;
  const [parent, grant] = await Promise.all([ // both at once, not one after the other (review A P4)
    isParentOf(viewer.id, ownerId),
    db.bodyDataGrant.findUnique({ where: { ownerId_viewerId: { ownerId, viewerId: viewer.id } } }),
  ]);
  return parent || Boolean(grant);
}

/** Shop on someone's behalf: owner, parents of a minor, or an explicit grant. */
export async function canShopFor(viewer: Viewer, ownerId: string): Promise<boolean> {
  if (viewer.id === ownerId) return true;
  const [parent, grant] = await Promise.all([
    isParentOf(viewer.id, ownerId),
    db.shopForGrant.findUnique({ where: { ownerId_shopperId: { ownerId, shopperId: viewer.id } } }),
  ]);
  return parent || Boolean(grant);
}

/** The people among `ownerIds` the viewer may shop for, in two queries however many people there are (review A P4). */
export async function canShopForMany(viewer: Viewer, ownerIds: string[]): Promise<Set<string>> {
  const others = ownerIds.filter((id) => id !== viewer.id);
  const [wards, grants] = others.length
    ? await Promise.all([
      db.guardianLink.findMany({ where: { parentId: viewer.id, minorId: { in: others } }, select: { minorId: true } }),
      db.shopForGrant.findMany({ where: { shopperId: viewer.id, ownerId: { in: others } }, select: { ownerId: true } }),
    ])
    : [[], []];
  return new Set([...(ownerIds.includes(viewer.id) ? [viewer.id] : []), ...wards.map((w) => w.minorId), ...grants.map((g) => g.ownerId)]);
}

/** Minors may keep body photos only while a parent approval is on record. Adults always may. */
export async function bodyPhotosAllowed(ownerId: string): Promise<{ allowed: boolean; approvedBy?: string; approvedAt?: Date }> {
  const owner = await db.person.findUnique({ where: { id: ownerId }, select: { role: true } });
  if (!owner) return { allowed: false };
  if (owner.role !== "minor") return { allowed: true };
  const a = await db.minorBodyImageApproval.findUnique({ where: { minorId: ownerId }, include: { approvedBy: { select: { name: true } } } });
  return a ? { allowed: true, approvedBy: a.approvedBy.name.split(" ")[0], approvedAt: a.approvedAt } : { allowed: false };
}

/** A minor's body data never leaves the family: no grants, no shoppers beyond parents. Nobody unknown can grant either (review A S8). */
export async function canGrantBodyAccess(ownerId: string): Promise<boolean> {
  const owner = await db.person.findUnique({ where: { id: ownerId }, select: { role: true } });
  return owner ? owner.role !== "minor" : false;
}

import { db } from "@/lib/db";
import type { Person } from "@/generated/prisma/client";

export type Viewer = Pick<Person, "id" | "role">;
export type ClosetView = { kind: "person"; personId: string; name: string } | { kind: "family" };
export const VIEW_COOKIE = "fc_view";

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

/** Turns the fc_view cookie into a view, falling back to the viewer's own closet. */
export async function resolveView(viewer: Viewer, cookieValue: string | undefined): Promise<ClosetView> {
  if (cookieValue === "family") return { kind: "family" };
  if (cookieValue && cookieValue !== viewer.id) {
    const p = await db.person.findUnique({ where: { id: cookieValue }, select: { id: true, name: true, status: true } });
    if (p && p.status !== "removed") return { kind: "person", personId: p.id, name: p.name.split(" ")[0] };
  }
  const me = await db.person.findUniqueOrThrow({ where: { id: viewer.id }, select: { name: true } });
  return { kind: "person", personId: viewer.id, name: me.name.split(" ")[0] };
}

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

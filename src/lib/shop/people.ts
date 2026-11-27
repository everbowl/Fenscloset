import { db } from "@/lib/db";
import type { Viewer } from "@/lib/people/visibility";

export type ShopPerson = { id: string; name: string };

/**
 * Who the Shop may shop for (the "Shopping for" switcher): yourself, your kids, and anyone who allowed it in
 * their Settings. `forParam` (?for=) picks one of them; anyone else falls back to the viewer.
 */
export async function shoppingFor(me: Viewer, forParam?: string | null): Promise<{ people: ShopPerson[]; forPersonId: string }> {
  // Three queries, not two per family member (review E F1): the people, whose parent I am, who let me shop for them.
  const [people, kids, grants] = await Promise.all([
    db.person.findMany({ where: { status: { not: "removed" } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    db.guardianLink.findMany({ where: { parentId: me.id }, select: { minorId: true } }),
    db.shopForGrant.findMany({ where: { shopperId: me.id }, select: { ownerId: true } }),
  ]);
  const ok = new Set([me.id, ...kids.map((k) => k.minorId), ...grants.map((g) => g.ownerId)]);
  const allowed: ShopPerson[] = people.filter((p) => ok.has(p.id)).map((p) => ({ id: p.id, name: p.name.split(" ")[0] }));
  const forPersonId = forParam && allowed.some((p) => p.id === forParam) ? forParam : me.id;
  return { people: allowed, forPersonId };
}

import { db } from "@/lib/db";
import { canShopFor, type Viewer } from "@/lib/people/visibility";

export type ShopPerson = { id: string; name: string };

/**
 * Who the Shop may shop for (the "Shopping for" switcher): yourself, your kids, and anyone who allowed it in
 * their Settings. `forParam` (?for=) picks one of them; anyone else falls back to the viewer.
 */
export async function shoppingFor(me: Viewer, forParam?: string | null): Promise<{ people: ShopPerson[]; forPersonId: string }> {
  const people = await db.person.findMany({ where: { status: { not: "removed" } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  const allowed: ShopPerson[] = [];
  for (const p of people) if (await canShopFor(me, p.id)) allowed.push({ id: p.id, name: p.name.split(" ")[0] });
  const forPersonId = forParam && allowed.some((p) => p.id === forParam) ? forParam : me.id;
  return { people: allowed, forPersonId };
}

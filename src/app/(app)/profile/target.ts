import { cookies } from "next/headers";
import { requirePerson } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { resolveView, VIEW_COOKIE, type Viewer } from "@/lib/people/visibility";
import type { Person } from "@/generated/prisma/client";

export type ProfileTarget = {
  viewer: Person;
  owner: { id: string; name: string; first: string; role: Viewer["role"] };
  mine: boolean;
  /** Owner, or a parent of a minor owner. */
  canEdit: boolean;
};

/** Whose profile the /profile screens show: the person picked in the header switcher (Family → yourself). */
export async function resolveProfileTarget(): Promise<ProfileTarget> {
  const viewer = await requirePerson();
  const view = await resolveView(viewer, (await cookies()).get(VIEW_COOKIE)?.value);
  const ownerId = view.kind === "person" ? view.personId : viewer.id;
  const owner = await db.person.findUniqueOrThrow({ where: { id: ownerId }, select: { id: true, name: true, role: true } });
  const mine = owner.id === viewer.id;
  const parent = mine ? null : await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: owner.id, parentId: viewer.id } } });
  return { viewer, owner: { ...owner, first: owner.name.split(" ")[0] }, mine, canEdit: mine || Boolean(parent) };
}

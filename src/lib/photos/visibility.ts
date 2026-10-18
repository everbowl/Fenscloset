import { db } from "@/lib/db";
import { parseKey } from "@/lib/storage";
import { canSeeBodyData } from "@/lib/people/visibility";
import type { Role } from "@/generated/prisma/client";

export type Viewer = { id: string; role: Role; status?: string };

/**
 * Who may see a photo (Q13 A + privacy rules):
 * - the owner, always;
 * - a parent of a minor owner, always;
 * - any other active family member may see photos that belong to a confirmed item
 *   (closets are browsable across the family), except a minor's worn photos,
 *   which stay with the minor and their parents;
 * - nothing else: unconfirmed imports and avatars/worn shots of minors stay private.
 */
export async function canViewKey(viewer: Viewer, key: string): Promise<boolean> {
  const parsed = parseKey(key);
  if (!parsed) return false;
  if (viewer.status === "removed") return false;
  if (parsed.ownerId === viewer.id) return true;
  if (parsed.kind === "bodies") return canSeeBodyData(viewer, parsed.ownerId);
  const owner = await db.person.findUnique({ where: { id: parsed.ownerId }, select: { id: true, role: true, status: true } });
  if (!owner || owner.status === "removed") return false;
  if (owner.role === "minor") {
    const link = await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: owner.id, parentId: viewer.id } } });
    if (link) return true;
  }
  if (parsed.kind === "avatars") return true;
  const photo = await db.itemPhoto.findUnique({ where: { bucketKey: key }, select: { kind: true } });
  if (!photo) return false;
  if (photo.kind === "worn" && owner.role === "minor") return false;
  return true;
}

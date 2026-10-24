import { db } from "@/lib/db";
import type { Viewer } from "@/lib/people/visibility";

/**
 * Photo tips for Add clothes: the general "before you start" rules plus one tip per category
 * (admins edit those under Lists → Categories). Each person can hide the panel and bring it back.
 */

export const GENERAL_TIPS: string[] = [
  "One piece per photo. Never a pile.",
  "Lay it flat on a plain, light background, or hang it on a plain wall. No patterned rugs.",
  "Front side, done up: buttons, zips, sleeves out. Smooth the wrinkles.",
  "Stand straight above it so the piece fills the frame. No angles.",
  "Daylight, no flash. By a window is perfect.",
  "Shoot the whole closet in your camera app first, then pick them all here at once.",
];

export type CategoryTip = { id: string; name: string; tip: string };
export type AddTips = { hidden: boolean; general: string[]; categories: CategoryTip[] };

export async function getAddTips(personId: string): Promise<AddTips> {
  const [p, cats] = await Promise.all([
    db.person.findUniqueOrThrow({ where: { id: personId }, select: { addTipsHidden: true } }),
    db.category.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, photoTip: true } }),
  ]);
  return { hidden: p.addTipsHidden, general: GENERAL_TIPS, categories: cats.filter((c) => c.photoTip).map((c) => ({ id: c.id, name: c.name, tip: c.photoTip! })) };
}

export async function setAddTipsHidden(viewer: Viewer, hidden: boolean): Promise<void> {
  await db.person.update({ where: { id: viewer.id }, data: { addTipsHidden: hidden } });
}

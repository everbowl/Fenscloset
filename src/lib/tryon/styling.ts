import { db } from "@/lib/db";
import { featuresOf, type StylingChoice, type StylingLists } from "@/lib/tryon/features";

export * from "@/lib/tryon/features";

/** The features of a whole look: the union over its pieces. */
export async function lookFeatures(itemIds: string[]): Promise<string[]> {
  if (!itemIds.length) return [];
  const items = await db.item.findMany({ where: { id: { in: itemIds } }, select: { features: true, category: { select: { name: true } }, subcategory: { select: { name: true } } } });
  const all = new Set<string>();
  for (const it of items) for (const f of featuresOf({ features: it.features, category: it.category?.name, subcategory: it.subcategory?.name })) all.add(f);
  return [...all].sort();
}

export async function loadStylingLists(): Promise<StylingLists> {
  const [poses, groups] = await Promise.all([
    db.mirrorPose.findMany({ where: { isArchived: false }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, prompt: true } }),
    db.wearGroup.findMany({ where: { isArchived: false }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, needs: true, options: { where: { isArchived: false }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, prompt: true } } } }),
  ]);
  return { poses, groups: groups.map((g) => ({ ...g, needs: g.needs.split(/\s+/).filter(Boolean) })) };
}

/** The person's remembered choices, if any. */
export async function loadPrefs(personId: string): Promise<StylingChoice> {
  const p = await db.person.findUnique({ where: { id: personId }, select: { mirrorPrefs: true } });
  const raw = (p?.mirrorPrefs ?? null) as StylingChoice | null;
  return raw && typeof raw === "object" ? { poseId: typeof raw.poseId === "string" ? raw.poseId : null, options: raw.options && typeof raw.options === "object" ? raw.options : {} } : {};
}

/** Remember a change so the next look opens the same way. Only ids from the lists are kept. */
export async function savePrefs(personId: string, lists: StylingLists, pick: StylingChoice): Promise<void> {
  const current = await loadPrefs(personId);
  const options = { ...(current.options ?? {}) };
  for (const [gid, oid] of Object.entries(pick.options ?? {})) {
    const g = lists.groups.find((x) => x.id === gid);
    if (g?.options.some((o) => o.id === oid)) options[gid] = oid;
  }
  const poseId = pick.poseId !== undefined ? (lists.poses.some((p) => p.id === pick.poseId) ? pick.poseId : null) : current.poseId ?? null;
  await db.person.update({ where: { id: personId }, data: { mirrorPrefs: { poseId, options } } });
}


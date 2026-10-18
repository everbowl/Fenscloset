import { db } from "@/lib/db";
import { deleteObject } from "@/lib/storage";
import { fromDayKey } from "@/lib/dates";
import { canDress, OutfitError, wearItems, type Piece } from "@/lib/outfits/engine";
import type { ClosetView, Viewer } from "@/lib/people/visibility";

/**
 * The Fits calendar (screen 05): one fit per person per day, with the pieces, an optional photo of the night,
 * and the people it is shared with. A fit is seen by its owner, the people tagged on it, and a minor owner's parents.
 */

export type FitDay = { date: string; fitId: string; photoKey: string | null; thumbKey: string | null; ownerName: string };
export type FitView = {
  id: string; date: string; title: string; ownerId: string; ownerName: string; photoKey: string | null;
  pieces: Piece[]; viewerIds: string[]; fixedViewerIds: string[]; visibility: string; canEdit: boolean;
};

async function parentIds(personId: string): Promise<string[]> {
  return (await db.guardianLink.findMany({ where: { minorId: personId }, select: { parentId: true } })).map((g) => g.parentId);
}

function visibleWhere(viewerId: string) {
  return { OR: [{ personId: viewerId }, { viewers: { some: { personId: viewerId } } }, { person: { guardians: { some: { parentId: viewerId } } } }] };
}

const fitInclude = {
  person: { select: { id: true, name: true, role: true } },
  viewers: { select: { personId: true } },
  items: { orderBy: { sortOrder: "asc" as const }, include: { item: { select: { id: true, name: true, ownerId: true, category: { select: { name: true } }, subcategory: { select: { name: true } }, photos: { where: { kind: "thumb" as const }, take: 1, select: { bucketKey: true } } } } } },
};

/** Days with a fit in a month, for the grid. Family view shows every fit the viewer may see. */
export async function listMonth(viewer: Viewer, view: ClosetView, year: number, month0: number): Promise<FitDay[]> {
  const from = `${year}-${String(month0 + 1).padStart(2, "0")}-01`;
  const to = `${year}-${String(month0 + 1).padStart(2, "0")}-31`;
  const fits = await db.fit.findMany({
    where: { date: { gte: from, lte: to }, ...(view.kind === "person" ? { personId: view.personId } : {}), ...visibleWhere(viewer.id) },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: { id: true, date: true, photoKey: true, person: { select: { name: true } }, items: { orderBy: { sortOrder: "asc" }, take: 1, select: { item: { select: { photos: { where: { kind: "thumb" }, take: 1, select: { bucketKey: true } } } } } } },
  });
  return fits.map((f) => ({ date: f.date, fitId: f.id, photoKey: f.photoKey, thumbKey: f.items[0]?.item.photos[0]?.bucketKey ?? null, ownerName: f.person.name.split(" ")[0] }));
}

async function toView(viewer: Viewer, f: NonNullable<Awaited<ReturnType<typeof findFit>>>): Promise<FitView> {
  const fixed = f.person.role === "minor" ? await parentIds(f.person.id) : [];
  const names = await db.person.findMany({ where: { id: { in: [f.person.id, ...fixed, ...f.viewers.map((v) => v.personId)] } }, select: { id: true, name: true } });
  const order = [f.person.id, ...fixed, ...f.viewers.map((v) => v.personId)].filter((id, i, a) => a.indexOf(id) === i);
  const list = order.map((id) => names.find((n) => n.id === id)?.name.split(" ")[0]).filter(Boolean);
  return {
    id: f.id, date: f.date, title: f.title, ownerId: f.person.id, ownerName: f.person.name.split(" ")[0], photoKey: f.photoKey,
    pieces: f.items.map((fi) => ({ id: fi.item.id, name: fi.item.name ?? "Untitled piece", label: (fi.item.subcategory?.name ?? fi.item.category?.name ?? "piece").toUpperCase(), thumbKey: fi.item.photos[0]?.bucketKey ?? null, ownerId: fi.item.ownerId })),
    viewerIds: f.viewers.map((v) => v.personId).filter((id) => !fixed.includes(id)),
    fixedViewerIds: fixed,
    visibility: `Visible to ${list.join(", ")} only`,
    canEdit: await canDress(viewer, f.person.id),
  };
}

function findFit(id: string) {
  return db.fit.findUnique({ where: { id }, include: fitInclude });
}

export async function getFit(viewer: Viewer, fitId: string): Promise<FitView | null> {
  const f = await db.fit.findFirst({ where: { id: fitId, ...visibleWhere(viewer.id) }, include: fitInclude });
  return f ? toView(viewer, f) : null;
}

/** The fits of one day the viewer may see (one per person). */
export async function getDay(viewer: Viewer, view: ClosetView, date: string): Promise<FitView[]> {
  const fits = await db.fit.findMany({ where: { date, ...(view.kind === "person" ? { personId: view.personId } : {}), ...visibleWhere(viewer.id) }, orderBy: { createdAt: "asc" }, include: fitInclude });
  return Promise.all(fits.map((f) => toView(viewer, f)));
}

async function assertOwnerish(viewer: Viewer, fitId: string) {
  const f = await db.fit.findUnique({ where: { id: fitId }, select: { personId: true } });
  if (!f) throw new OutfitError("That fit is gone.", 404);
  if (!(await canDress(viewer, f.personId))) throw new OutfitError("Only the person (or their parent) can change their fit.", 403);
  return f;
}

/** SAVE THE FIT for any day: the pieces picked from the closet become that day's fit and wear log. */
export async function saveFit(viewer: Viewer, personId: string, date: string, itemIds: string[], title: string): Promise<string> {
  if (!(await canDress(viewer, personId))) throw new OutfitError("Only the person (or their parent) can save their fit.", 403);
  const own = await db.item.findMany({ where: { id: { in: itemIds }, OR: [{ ownerId: personId }, { closets: { some: { closet: { kind: "family" } } } }] }, select: { id: true } });
  if (!own.length) throw new OutfitError("Pick at least one piece.");
  return wearItems(personId, date, itemIds.filter((id) => own.some((o) => o.id === id)), { title: title.trim() || "Today’s look" });
}

export async function setFitTitle(viewer: Viewer, fitId: string, title: string): Promise<void> {
  await assertOwnerish(viewer, fitId);
  const t = title.trim().slice(0, 60);
  if (!t) throw new OutfitError("Give the fit a name.");
  await db.fit.update({ where: { id: fitId }, data: { title: t } });
}

export async function setFitPhoto(viewer: Viewer, fitId: string, key: string | null): Promise<void> {
  const f = await assertOwnerish(viewer, fitId);
  const cur = await db.fit.findUniqueOrThrow({ where: { id: fitId }, select: { photoKey: true } });
  if (key && !key.startsWith(`fits/${f.personId}/`)) throw new OutfitError("That photo doesn't belong to this fit.");
  if (cur.photoKey && cur.photoKey !== key) await deleteObject(cur.photoKey).catch(() => {});
  await db.fit.update({ where: { id: fitId }, data: { photoKey: key } });
}

/** SHARE: who may see this fit (the owner and a minor's parents always can). */
export async function setFitViewers(viewer: Viewer, fitId: string, personIds: string[]): Promise<void> {
  const f = await assertOwnerish(viewer, fitId);
  const people = await db.person.findMany({ where: { id: { in: personIds }, status: { not: "removed" }, NOT: { id: f.personId } }, select: { id: true } });
  await db.$transaction([
    db.fitViewer.deleteMany({ where: { fitId } }),
    db.fitViewer.createMany({ data: people.map((p) => ({ fitId, personId: p.id })) }),
  ]);
}

/** Remove a fit and undo its wear log. */
export async function deleteFit(viewer: Viewer, fitId: string): Promise<void> {
  await assertOwnerish(viewer, fitId);
  await db.$transaction(async (tx) => {
    const fit = await tx.fit.findUniqueOrThrow({ where: { id: fitId }, include: { wearLogs: true } });
    await tx.wearLog.deleteMany({ where: { fitId } });
    for (const w of fit.wearLogs) {
      const prev = await tx.wearLog.findFirst({ where: { itemId: w.itemId }, orderBy: { wornOn: "desc" }, select: { wornOn: true } });
      await tx.item.update({ where: { id: w.itemId }, data: { wearCount: { decrement: 1 }, lastWornAt: prev ? fromDayKey(prev.wornOn) : null } });
    }
    await tx.fit.delete({ where: { id: fitId } });
    if (fit.photoKey) await deleteObject(fit.photoKey).catch(() => {});
  });
}

/** Wear history for the item detail screen. */
export async function wearHistory(itemId: string): Promise<{ wornOn: string; fitId: string | null; title: string | null }[]> {
  const logs = await db.wearLog.findMany({ where: { itemId }, orderBy: { wornOn: "desc" }, take: 20, include: { fit: { select: { title: true } } } });
  return logs.map((l) => ({ wornOn: l.wornOn, fitId: l.fitId, title: l.fit?.title ?? null }));
}

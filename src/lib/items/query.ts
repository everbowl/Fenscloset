import { db } from "@/lib/db";
import type { ClosetView } from "@/lib/people/visibility";
import type { LaundryStatus } from "@/generated/prisma/client";

export type ItemCardData = {
  id: string;
  name: string;
  thumbKey: string | null;
  categoryName: string | null;
  status: string;
  ownerId: string;
  ownerName: string;
};

export function statusWord(it: { laundryStatus: LaundryStatus; wearCount: number }): string {
  if (it.laundryStatus === "dirty") return "Laundry";
  if (it.laundryStatus === "cleaners") return "At cleaners";
  if (it.wearCount > 0) return `Worn ${it.wearCount}×`;
  return "New";
}

const cardSelect = {
  id: true, name: true, ownerId: true, laundryStatus: true, wearCount: true,
  owner: { select: { name: true } },
  category: { select: { name: true } },
  photos: { where: { kind: "thumb" as const }, take: 1, select: { bucketKey: true } },
};

/** Grid data for a closet view, newest first. `q` matches name or brand. */
export async function listClosetItems(view: ClosetView, opts: { categoryId?: string; q?: string } = {}): Promise<ItemCardData[]> {
  const q = opts.q?.trim();
  const items = await db.item.findMany({
    where: {
      ...(view.kind === "family" ? { closets: { some: { closet: { kind: "family" } } } } : { ownerId: view.personId }),
      retiredAt: null,
      ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { brand: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: cardSelect,
  });
  return items.map((it) => ({
    id: it.id, name: it.name ?? "Untitled piece", thumbKey: it.photos[0]?.bucketKey ?? null, categoryName: it.category?.name ?? null,
    status: statusWord(it), ownerId: it.ownerId, ownerName: it.owner.name.split(" ")[0],
  }));
}

export async function countClosetItems(view: ClosetView): Promise<number> {
  return db.item.count({ where: { retiredAt: null, ...(view.kind === "family" ? { closets: { some: { closet: { kind: "family" } } } } : { ownerId: view.personId }) } });
}

export async function getItemDetail(itemId: string) {
  return db.item.findUnique({
    where: { id: itemId },
    include: {
      owner: { select: { id: true, name: true, role: true } },
      category: true, subcategory: true, brand: true, store: true,
      colors: true, patterns: true, fabrics: true, seasons: true, formalities: true, occasions: true, tags: true,
      photos: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      closets: { include: { closet: true } },
      shares: { include: { person: { select: { id: true, name: true } } } },
    },
  });
}
export type ItemDetail = NonNullable<Awaited<ReturnType<typeof getItemDetail>>>;

import { loadTagLists, type Named, type TagLists } from "@/lib/ai/tag-item";

export type ItemLists = TagLists & { occasions: Named[]; tags: Named[]; stores: Named[]; closets: (Named & { kind: "family" | "custom" })[]; people: Named[] };

/** Everything the item editor's rows can pick from. */
export async function loadItemLists(viewerId: string): Promise<ItemLists> {
  const sel = { id: true, name: true } as const;
  const [tagLists, occasions, tags, stores, closets, people] = await Promise.all([
    loadTagLists(),
    db.occasion.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: sel }),
    db.tag.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: sel }),
    db.store.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: sel }),
    db.closet.findMany({ where: { isArchived: false, kind: { in: ["family", "custom"] } }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }], select: { id: true, name: true, kind: true } }),
    db.person.findMany({ where: { status: { not: "removed" }, NOT: { id: viewerId } }, orderBy: { createdAt: "asc" }, select: sel }),
  ]);
  return { ...tagLists, occasions, tags, stores, closets: closets.map((c) => ({ id: c.id, name: c.name, kind: c.kind as "family" | "custom" })), people: people.map((p) => ({ id: p.id, name: p.name.split(" ")[0] })) };
}

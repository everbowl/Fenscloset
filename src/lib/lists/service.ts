import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { LIST_DEFS, type ListKind } from "@/lib/lists/registry";

export type ListEntry = {
  id: string;
  name: string;
  sortOrder: number;
  isArchived: boolean;
  parentId?: string | null;
  hex?: string;
  url?: string | null;
  unit?: string;
  /** categories only: how to photograph this kind of piece */
  photoTip?: string | null;
  /** mirror poses and wear options: what the artist is told to change */
  prompt?: string;
  /** wear groups: the item features a look must have for the group to show */
  needs?: string;
  /** closets only */
  closetKind?: "personal" | "family" | "custom";
  ownerId?: string | null;
};

export type EntryInput = { name: string; parentId?: string | null; hex?: string; url?: string | null; unit?: string; photoTip?: string | null; prompt?: string; needs?: string };

export class InUseError extends Error {
  constructor(public readonly count: number, public readonly what: string) {
    super(`In use by ${count} ${what}`);
    this.name = "InUseError";
  }
}
export class ProtectedEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtectedEntryError";
  }
}
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// Prisma delegates differ per model; this is the common surface the generic service relies on.
type AnyRow = Record<string, unknown>;
type Delegate = {
  findMany: (args: AnyRow) => Promise<AnyRow[]>;
  findUnique: (args: AnyRow) => Promise<AnyRow | null>;
  create: (args: AnyRow) => Promise<AnyRow>;
  update: (args: AnyRow) => Promise<AnyRow>;
  delete: (args: AnyRow) => Promise<AnyRow>;
  count: (args?: AnyRow) => Promise<number>;
};

function delegateFor(kind: ListKind): Delegate {
  return (db as unknown as Record<string, Delegate>)[LIST_DEFS[kind].delegate];
}

function toEntry(kind: ListKind, row: AnyRow): ListEntry {
  const def = LIST_DEFS[kind];
  return {
    id: row.id as string,
    name: row.name as string,
    sortOrder: row.sortOrder as number,
    isArchived: row.isArchived as boolean,
    parentId: def.parent ? (row[def.parent.field] as string) : undefined,
    hex: typeof row.hex === "string" ? row.hex : undefined,
    photoTip: kind === "category" ? ((row.photoTip as string | null) ?? null) : undefined,
    url: kind === "store" ? ((row.url as string | null) ?? null) : undefined,
    unit: kind === "measurementKind" ? ((row.unit as string) ?? "") : undefined,
    prompt: kind === "mirrorPose" || kind === "wearOption" ? ((row.prompt as string) ?? "") : undefined,
    needs: kind === "wearGroup" ? ((row.needs as string) ?? "") : undefined,
    closetKind: kind === "closet" ? (row.kind as ListEntry["closetKind"]) : undefined,
    ownerId: kind === "closet" ? ((row.ownerId as string | null) ?? null) : undefined,
  };
}

function cleanName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new ValidationError("Give it a name.");
  if (n.length > 60) throw new ValidationError("Keep names under 60 characters.");
  return n;
}

function extraData(kind: ListKind, input: EntryInput, forCreate: boolean): AnyRow {
  const data: AnyRow = {};
  if (kind === "color") {
    const hex = (input.hex ?? "").trim();
    if (forCreate || input.hex !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new ValidationError("Pick a swatch color.");
      data.hex = hex.toUpperCase();
    }
  }
  if (kind === "measurementKind" && input.unit !== undefined) data.unit = (input.unit ?? "").trim().slice(0, 12);
  if ((kind === "mirrorPose" || kind === "wearOption") && input.prompt !== undefined) data.prompt = (input.prompt ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
  if (kind === "wearGroup" && input.needs !== undefined) data.needs = (input.needs ?? "").trim().toLowerCase().replace(/[^a-z_ ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (kind === "category" && input.photoTip !== undefined) { const tip = (input.photoTip ?? "").trim().slice(0, 160); data.photoTip = tip || null; }
  if (kind === "store" && input.url !== undefined) {
    const raw = (input.url ?? "").trim();
    if (!raw) data.url = null;
    else {
      // A real web address, with a host (review E E4: anything used to be saved with https:// in front).
      let u: URL;
      try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new ValidationError("Enter a web address like nordstrom.com."); }
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw new ValidationError("Enter a web address like nordstrom.com.");
      data.url = u.toString().slice(0, 500);
    }
  }
  return data;
}

/**
 * How many things reference this entry. Deleting is blocked when > 0 and the screen offers Archive instead. Items count,
 * and so do people's own data: sizes in a brand, favorite brands and stores, loved and avoided colors, the section a person
 * shops in, check-in answers, plans and fits on an occasion (review E E1: deleting a brand used to wipe every size in it).
 */
async function inUseCount(kind: ListKind, id: string): Promise<{ count: number; what: string }> {
  const sum = async (parts: [Promise<number>, string][]): Promise<{ count: number; what: string }> => {
    const counts = await Promise.all(parts.map(([p]) => p));
    const used = parts.map(([, what], i) => ({ count: counts[i], what })).filter((x) => x.count > 0);
    if (!used.length) return { count: 0, what: "items" };
    const [first, ...rest] = used; // reads "In use by 2 items and 3 sizes people recorded"
    return { count: first.count, what: [first.what, ...rest.map((x) => `${x.count} ${x.what}`)].join(" and ") };
  };
  switch (kind) {
    case "category": return { count: await db.item.count({ where: { categoryId: id } }), what: "items" };
    case "subcategory": return { count: await db.item.count({ where: { subcategoryId: id } }), what: "items" };
    case "brand": return sum([[db.item.count({ where: { brandId: id } }), "items"], [db.bodySizeByBrand.count({ where: { brandId: id } }), "sizes people recorded"], [db.person.count({ where: { favoriteBrands: { some: { id } } } }), "people's favorites"]]);
    case "store": return sum([[db.item.count({ where: { storeId: id } }), "items"], [db.person.count({ where: { favoriteStores: { some: { id } } } }), "people's favorites"]]);
    case "color": return sum([[db.item.count({ where: { colors: { some: { id } } } }), "items"], [db.person.count({ where: { OR: [{ lovedColors: { some: { id } } }, { avoidColors: { some: { id } } }] } }), "style profiles"]]);
    case "pattern": return { count: await db.item.count({ where: { patterns: { some: { id } } } }), what: "items" };
    case "fabric": return { count: await db.item.count({ where: { fabrics: { some: { id } } } }), what: "items" };
    case "season": return { count: await db.item.count({ where: { seasons: { some: { id } } } }), what: "items" };
    case "formality": return { count: await db.item.count({ where: { formalities: { some: { id } } } }), what: "items" };
    case "occasion": return sum([[db.item.count({ where: { occasions: { some: { id } } } }), "items"], [db.dayPlan.count({ where: { occasionId: id } }), "plans"], [db.fit.count({ where: { occasionId: id } }), "fits"], [db.togetherSession.count({ where: { occasionId: id } }), "together sessions"]]);
    case "tag": return { count: await db.item.count({ where: { tags: { some: { id } } } }), what: "items" };
    case "measurementKind": return { count: await db.bodyMeasurement.count({ where: { kindId: id } }), what: "profiles" };
    case "styleWord": return { count: await db.person.count({ where: { styleWords: { some: { id } } } }), what: "profiles" };
    case "closet": return { count: await db.itemCloset.count({ where: { closetId: id } }), what: "items" };
    case "checkInScale": return { count: await db.checkInOption.count({ where: { scaleId: id } }), what: "options" };
    case "checkInOption": return { count: await db.checkInAnswer.count({ where: { optionId: id } }), what: "check-ins" };
    case "wearGroup": return { count: await db.wearOption.count({ where: { groupId: id } }), what: "options" };
    case "shopSection": return { count: await db.person.count({ where: { shopSectionId: id } }), what: "people" };
    case "size": { const o = await db.sizeOption.findUnique({ where: { id } }); return { count: o ? await db.bodySizeByBrand.count({ where: { categoryId: o.categoryId, size: o.name } }) : 0, what: "profiles" }; }
    default: return { count: 0, what: "items" };
  }
}

export async function listEntries(kind: ListKind, opts: { parentId?: string; includeArchived?: boolean } = {}): Promise<ListEntry[]> {
  const def = LIST_DEFS[kind];
  const where: AnyRow = {};
  if (!opts.includeArchived) where.isArchived = false;
  if (def.parent && opts.parentId) where[def.parent.field] = opts.parentId;
  const rows = await delegateFor(kind).findMany({ where, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return rows.map((r) => toEntry(kind, r));
}

export async function createEntry(kind: ListKind, input: EntryInput): Promise<ListEntry> {
  const def = LIST_DEFS[kind];
  const name = cleanName(input.name);
  const data: AnyRow = { name, ...extraData(kind, input, true) };
  if (def.parent) {
    if (!input.parentId) throw new ValidationError(`Choose a ${def.parent.label.toLowerCase()} first.`);
    data[def.parent.field] = input.parentId;
  }
  if (kind === "closet") data.kind = "custom";
  const siblings = await delegateFor(kind).count({ where: def.parent ? { [def.parent.field]: input.parentId } : {} });
  data.sortOrder = siblings;
  try {
    const row = await delegateFor(kind).create({ data });
    return toEntry(kind, row);
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new ValidationError(`"${name}" already exists.`);
    throw e;
  }
}

export async function updateEntry(kind: ListKind, id: string, input: Partial<EntryInput> & { isArchived?: boolean }): Promise<ListEntry> {
  const data: AnyRow = {};
  if (input.name !== undefined) data.name = cleanName(input.name);
  if (input.isArchived !== undefined) data.isArchived = input.isArchived;
  Object.assign(data, extraData(kind, input as EntryInput, false));
  if (kind === "closet" && input.isArchived) {
    const row = await delegateFor(kind).findUnique({ where: { id } });
    if (row && row.kind !== "custom") throw new ProtectedEntryError("Personal and Family closets can't be archived.");
  }
  try {
    const row = await delegateFor(kind).update({ where: { id }, data });
    return toEntry(kind, row);
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new ValidationError(`"${data.name}" already exists.`);
    throw e;
  }
}

export async function deleteEntry(kind: ListKind, id: string): Promise<void> {
  if (kind === "closet") {
    const row = await delegateFor(kind).findUnique({ where: { id } });
    if (row && row.kind !== "custom") throw new ProtectedEntryError("Personal and Family closets can't be deleted.");
  }
  const usage = await inUseCount(kind, id);
  if (usage.count > 0) throw new InUseError(usage.count, usage.what);
  await delegateFor(kind).delete({ where: { id } });
}

/** Persists a new order, all at once or not at all (review E E2: the updates used to run outside the transaction). Ids not mentioned keep their relative order after the mentioned ones. */
export async function reorderEntries(kind: ListKind, orderedIds: string[]): Promise<void> {
  if (!orderedIds.length) return;
  // One statement for the whole list (review E E2, and 23 Nov: 152 row-by-row updates inside one transaction took seconds, and a
  // page that reloaded meanwhile cut the request and rolled every one of them back). The table is the model's name; no list
  // model is @@map'd.
  const table = LIST_DEFS[kind].delegate.replace(/^./, (c) => c.toUpperCase());
  const positions = orderedIds.map((_, i) => i);
  await db.$executeRaw`UPDATE ${Prisma.raw(`"${table}"`)} AS t SET "sortOrder" = v.ord FROM UNNEST(${orderedIds}::text[], ${positions}::int[]) AS v(id, ord) WHERE t.id = v.id`;
}

/** Counts per kind for the admin overview, in one round (review E E3). */
export async function countAll(): Promise<Record<ListKind, number>> {
  const kinds = Object.keys(LIST_DEFS) as ListKind[];
  const counts = await Promise.all(kinds.map((kind) => delegateFor(kind).count({ where: { isArchived: false } })));
  return Object.fromEntries(kinds.map((kind, i) => [kind, counts[i]])) as Record<ListKind, number>;
}

import { db } from "@/lib/db";
import { LIST_DEFS, type ListKind } from "@/lib/lists/registry";

export type ListEntry = {
  id: string;
  name: string;
  sortOrder: number;
  isArchived: boolean;
  parentId?: string | null;
  hex?: string;
  url?: string | null;
  /** closets only */
  closetKind?: "personal" | "family" | "custom";
  ownerId?: string | null;
};

export type EntryInput = { name: string; parentId?: string | null; hex?: string; url?: string | null };

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
    url: kind === "store" ? ((row.url as string | null) ?? null) : undefined,
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
  if (kind === "store" && input.url !== undefined) {
    const url = (input.url ?? "").trim();
    data.url = url ? (url.startsWith("http") ? url : `https://${url}`) : null;
  }
  return data;
}

/** How many things reference this entry. Deleting is blocked when > 0. Extended as new relations arrive. */
export async function inUseCount(kind: ListKind, id: string): Promise<{ count: number; what: string }> {
  switch (kind) {
    case "category": return { count: await db.item.count({ where: { categoryId: id } }), what: "items" };
    case "subcategory": return { count: await db.item.count({ where: { subcategoryId: id } }), what: "items" };
    case "brand": return { count: await db.item.count({ where: { brandId: id } }), what: "items" };
    case "store": return { count: await db.item.count({ where: { storeId: id } }), what: "items" };
    case "color": return { count: await db.item.count({ where: { colors: { some: { id } } } }), what: "items" };
    case "pattern": return { count: await db.item.count({ where: { patterns: { some: { id } } } }), what: "items" };
    case "fabric": return { count: await db.item.count({ where: { fabrics: { some: { id } } } }), what: "items" };
    case "season": return { count: await db.item.count({ where: { seasons: { some: { id } } } }), what: "items" };
    case "formality": return { count: await db.item.count({ where: { formalities: { some: { id } } } }), what: "items" };
    case "occasion": return { count: await db.item.count({ where: { occasions: { some: { id } } } }), what: "items" };
    case "tag": return { count: await db.item.count({ where: { tags: { some: { id } } } }), what: "items" };
    case "closet": return { count: await db.itemCloset.count({ where: { closetId: id } }), what: "items" };
    case "checkInScale": return { count: await db.checkInOption.count({ where: { scaleId: id } }), what: "options" };
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

export async function getEntry(kind: ListKind, id: string): Promise<ListEntry | null> {
  const row = await delegateFor(kind).findUnique({ where: { id } });
  return row ? toEntry(kind, row) : null;
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

/** Persists a new order. Ids not mentioned keep their relative order after the mentioned ones. */
export async function reorderEntries(kind: ListKind, orderedIds: string[]): Promise<void> {
  const d = delegateFor(kind);
  await db.$transaction(async () => {
    for (const [i, id] of orderedIds.entries()) await d.update({ where: { id }, data: { sortOrder: i } });
  });
}

/** Counts per kind for the admin overview. */
export async function countAll(): Promise<Record<ListKind, number>> {
  const out = {} as Record<ListKind, number>;
  for (const kind of Object.keys(LIST_DEFS) as ListKind[]) out[kind] = await delegateFor(kind).count({ where: { isArchived: false } });
  return out;
}

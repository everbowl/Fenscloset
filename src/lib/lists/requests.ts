import { db } from "@/lib/db";
import { LIST_DEFS, type ListKind } from "@/lib/lists/registry";

export class RequestError extends Error {}

/** "Jeff and Brittney": the admins, by first name, for the line after an ask. */
export async function adminFirstNames(): Promise<string> {
  const admins = await db.person.findMany({ where: { role: "admin", status: { not: "removed" } }, select: { name: true }, orderBy: { createdAt: "asc" } });
  const names = admins.map((a) => a.name.split(" ")[0]).filter(Boolean);
  if (!names.length) return "An admin";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * "Ask Jeff to add it" (Jeff, 31 Oct 2026, J1): someone who can't edit the lists asks for a word; an admin adds or
 * dismisses it under Admin → Lists. The same open ask is not recorded twice.
 */
export async function requestListEntry(personId: string, kind: ListKind, rawName: string, parentId?: string | null): Promise<{ admins: string; already: boolean }> {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name) throw new RequestError("Type the word first.");
  if (name.length > 60) throw new RequestError("Keep it under 60 characters.");
  const admins = await adminFirstNames();
  const open = await db.listRequest.findFirst({ where: { kind, status: "open", name: { equals: name, mode: "insensitive" } } });
  if (open) return { admins, already: true };
  await db.listRequest.create({ data: { kind, name, parentId: parentId ?? null, requestedById: personId } });
  return { admins, already: false };
}

export type ListRequestView = { id: string; kind: ListKind; kindLabel: string; name: string; parentId: string | null; askedBy: string; createdAt: Date };

export async function listOpenRequests(): Promise<ListRequestView[]> {
  const rows = await db.listRequest.findMany({ where: { status: "open" }, include: { requestedBy: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, kind: r.kind as ListKind, kindLabel: LIST_DEFS[r.kind as ListKind]?.label ?? r.kind, name: r.name, parentId: r.parentId, askedBy: r.requestedBy.name, createdAt: r.createdAt }));
}

export async function countOpenRequests(): Promise<number> {
  return db.listRequest.count({ where: { status: "open" } });
}

export async function resolveRequest(id: string, status: "added" | "dismissed" | "open"): Promise<void> {
  await db.listRequest.update({ where: { id }, data: { status } });
}

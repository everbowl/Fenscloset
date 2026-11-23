"use server";

import { revalidatePath } from "next/cache";
import { currentAdmin, requirePerson } from "@/lib/auth/current";
import { isListKind, type ListKind } from "@/lib/lists/registry";
import { createEntry, deleteEntry, reorderEntries, updateEntry, type EntryInput, type ListEntry } from "@/lib/lists/service";
import { RequestError, requestListEntry, resolveRequest } from "@/lib/lists/requests";

export type EntryResult = { ok: true; entry: ListEntry } | { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };

const ADMINS_ONLY = { ok: false, error: "Admins only." } as const;
// A bad kind answers in words, not with the error page (review A W9).
const NO_SUCH_LIST = { ok: false, error: "That list doesn't exist anymore." } as const;

function message(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "InUseError") {
      const { count, what } = e as unknown as { count: number; what: string };
      return `Can't delete: ${count} ${count === 1 ? what.replace(/s$/, "") : what} still use it. Move or change those first, or archive it instead.`;
    }
    if (e.name === "ValidationError" || e.name === "ProtectedEntryError") return e.message;
  }
  console.error(e);
  return "Something went wrong. Try again.";
}

function revalidate(kind: ListKind) {
  revalidatePath(`/admin/lists/${kind}`);
  revalidatePath("/admin/lists");
}

export async function createEntryAction(kind: string, input: EntryInput): Promise<EntryResult> {
  if (!(await currentAdmin())) return ADMINS_ONLY;
  if (!isListKind(kind)) return NO_SUCH_LIST;
  try {
    const entry = await createEntry(kind, input);
    revalidate(kind);
    return { ok: true, entry };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function updateEntryAction(kind: string, id: string, input: Partial<EntryInput> & { isArchived?: boolean }): Promise<EntryResult> {
  if (!(await currentAdmin())) return ADMINS_ONLY;
  if (!isListKind(kind)) return NO_SUCH_LIST;
  try {
    const entry = await updateEntry(kind, id, input);
    revalidate(kind);
    return { ok: true, entry };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function deleteEntryAction(kind: string, id: string): Promise<SimpleResult> {
  if (!(await currentAdmin())) return ADMINS_ONLY;
  if (!isListKind(kind)) return NO_SUCH_LIST;
  try {
    await deleteEntry(kind, id);
    revalidate(kind);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function reorderEntriesAction(kind: string, orderedIds: string[]): Promise<SimpleResult> {
  if (!(await currentAdmin())) return ADMINS_ONLY;
  if (!isListKind(kind)) return NO_SUCH_LIST;
  try {
    await reorderEntries(kind, orderedIds);
    revalidate(kind);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

// ---------- "Ask Jeff to add it" (J1) ----------

export async function requestEntryAction(kind: string, name: string, parentId?: string | null): Promise<{ ok: true; admins: string; already: boolean } | { ok: false; error: string }> {
  const me = await requirePerson();
  if (!isListKind(kind)) return NO_SUCH_LIST;
  try { const r = await requestListEntry(me.id, kind, name, parentId); revalidatePath("/admin/lists"); return { ok: true, ...r }; }
  catch (e) { if (e instanceof RequestError) return { ok: false, error: e.message }; console.error(e); return { ok: false, error: "Couldn’t send the ask. Try again." }; }
}

export async function resolveRequestAction(id: string, status: "added" | "dismissed" | "open"): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await currentAdmin())) return ADMINS_ONLY;
  try { await resolveRequest(id, status); revalidatePath("/admin/lists"); return { ok: true }; }
  catch (e) { console.error(e); return { ok: false, error: "Couldn’t update the ask. Try again." }; }
}

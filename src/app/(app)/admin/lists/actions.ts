"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/current";
import { isListKind, type ListKind } from "@/lib/lists/registry";
import { createEntry, deleteEntry, reorderEntries, updateEntry, type EntryInput, type ListEntry } from "@/lib/lists/service";

export type EntryResult = { ok: true; entry: ListEntry } | { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };

function assertKind(kind: string): asserts kind is ListKind {
  if (!isListKind(kind)) throw new Error("Unknown list");
}

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
  await requireAdmin();
  assertKind(kind);
  try {
    const entry = await createEntry(kind, input);
    revalidate(kind);
    return { ok: true, entry };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function updateEntryAction(kind: string, id: string, input: Partial<EntryInput> & { isArchived?: boolean }): Promise<EntryResult> {
  await requireAdmin();
  assertKind(kind);
  try {
    const entry = await updateEntry(kind, id, input);
    revalidate(kind);
    return { ok: true, entry };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function deleteEntryAction(kind: string, id: string): Promise<SimpleResult> {
  await requireAdmin();
  assertKind(kind);
  try {
    await deleteEntry(kind, id);
    revalidate(kind);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function reorderEntriesAction(kind: string, orderedIds: string[]): Promise<SimpleResult> {
  await requireAdmin();
  assertKind(kind);
  try {
    await reorderEntries(kind, orderedIds);
    revalidate(kind);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { addPieces, addToLook, deleteLook, LookError, openOrStartLook, removePiece, saveLook, type LookPieceInput } from "@/lib/looks/service";

export type Result = { ok: true } | { ok: false; error: string };

function failed(e: unknown): { ok: false; error: string } {
  if (e instanceof LookError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Try again." };
}

/** The screens that carry the tray or the Looks row. */
function touch(lookId?: string) {
  for (const p of ["/shop", "/shop/looking-for", "/closet", "/fits"]) revalidatePath(p);
  if (lookId) revalidatePath(`/looks/${lookId}`);
}

const ids = (xs: unknown): string[] => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string" && x.length < 64) : []);

/** "Add to a look" on a store find or a closet piece: onto the person's open look, started if there is none. */
export async function addToLookAction(personId: string, piece: LookPieceInput): Promise<Result & { lookId?: string; count?: number; added?: boolean }> {
  const me = await requirePerson();
  try { const r = await addToLook(me, personId, piece); touch(r.lookId); return { ok: true, ...r }; } catch (e) { return failed(e); }
}

/** The closet's pick mode: the picked pieces onto the open look. */
export async function addPickedToLookAction(personId: string, itemIds: string[]): Promise<Result & { lookId?: string; count?: number }> {
  const me = await requirePerson();
  try {
    const lookId = await openOrStartLook(me, personId);
    const r = await addPieces(me, lookId, ids(itemIds).map((itemId) => ({ itemId })));
    touch(lookId);
    return { ok: true, lookId, count: r.count };
  } catch (e) { return failed(e); }
}

/** "Add from the closet" on the look screen. */
export async function addPiecesAction(lookId: string, itemIds: string[]): Promise<Result & { count?: number }> {
  const me = await requirePerson();
  try { const r = await addPieces(me, lookId, ids(itemIds).map((itemId) => ({ itemId }))); touch(lookId); return { ok: true, count: r.count }; } catch (e) { return failed(e); }
}

export async function removePieceAction(lookId: string, pieceId: string): Promise<Result> {
  const me = await requirePerson();
  try { await removePiece(me, lookId, pieceId); touch(lookId); return { ok: true }; } catch (e) { return failed(e); }
}

/** Name and save (the first time), or rename. */
export async function saveLookAction(lookId: string, name: string): Promise<Result> {
  const me = await requirePerson();
  try { await saveLook(me, lookId, name); touch(lookId); return { ok: true }; } catch (e) { return failed(e); }
}

export async function deleteLookAction(lookId: string): Promise<Result> {
  const me = await requirePerson();
  try { await deleteLook(me, lookId); touch(); return { ok: true }; } catch (e) { return failed(e); }
}

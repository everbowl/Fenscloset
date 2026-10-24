"use server";

import { requirePerson } from "@/lib/auth/current";
import { ItemError } from "@/lib/items/service";
import { ValidationError } from "@/lib/lists/service";
import type { Product } from "@/lib/shop/products";
import { applyStyleMatchToEntry, applyStyleMatchToItem, ensureBrand, findStyleMatches, type EntryMatchResult, type ItemMatchResult, type StyleProbe } from "@/lib/store/match";

export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ItemError || e instanceof ValidationError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. Try again." };
}

/** A brand typed or picked from the national catalog: in the family's list, added if new. */
export async function ensureBrandAction(name: string): Promise<ActionResult<{ id: string; name: string }>> {
  await requirePerson();
  try { const b = await ensureBrand(name); return { ok: true, value: { id: b.id, name: b.name } }; } catch (e) { return fail(e); }
}

export async function styleMatchesAction(probe: StyleProbe): Promise<ActionResult<Product[]>> {
  await requirePerson();
  try { return { ok: true, value: await findStyleMatches(probe) }; } catch (e) { return fail(e); }
}

export async function matchEntryAction(entryId: string, pick: Product, brand?: string | null): Promise<ActionResult<EntryMatchResult>> {
  const person = await requirePerson();
  try { return { ok: true, value: await applyStyleMatchToEntry(person.id, entryId, pick, brand) }; } catch (e) { return fail(e); }
}

export async function matchItemAction(itemId: string, pick: Product, brand?: string | null): Promise<ActionResult<ItemMatchResult>> {
  const person = await requirePerson();
  try { return { ok: true, value: await applyStyleMatchToItem(person, itemId, pick, brand) }; } catch (e) { return fail(e); }
}

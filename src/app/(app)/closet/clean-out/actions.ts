"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { cleanOutDecision, unretire } from "@/lib/outfits/cleanout";
import { OutfitError } from "@/lib/outfits/engine";

export type Result = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try { await fn(); revalidatePath("/closet"); revalidatePath("/closet/clean-out"); revalidatePath("/today"); return { ok: true }; }
  catch (e) { if (e instanceof OutfitError) return { ok: false, error: e.message }; console.error(e); return { ok: false, error: "Something went wrong. Try again." }; }
}

export async function cleanOutAction(itemId: string, decision: "keep" | "donate" | "sell"): Promise<Result> {
  const me = await requirePerson(); return run(() => cleanOutDecision(me, itemId, decision));
}
export async function unretireAction(itemId: string): Promise<Result> {
  const me = await requirePerson(); return run(() => unretire(me, itemId));
}

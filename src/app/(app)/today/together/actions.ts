"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { loadTodayContext } from "@/lib/today/context";
import { createTogether } from "@/lib/outfits/together";
import { OutfitError, wearBoard } from "@/lib/outfits/engine";
import type { TogetherMode } from "@/generated/prisma/client";

export type Result = { ok: true; id?: string } | { ok: false; error: string };

export async function dressTogetherAction(input: { personIds: string[]; mode: TogetherMode; occasionId?: string | null; occasionText?: string | null }): Promise<Result> {
  const me = await requirePerson();
  try {
    const ctx = await loadTodayContext(me, me.id);
    const t = await createTogether(me, { personIds: input.personIds, mode: input.mode, occasionId: input.occasionId, occasionText: input.occasionText, date: ctx.date, ctx });
    revalidatePath("/today/together"); revalidatePath("/today");
    return { ok: true, id: t.id };
  } catch (e) {
    if (e instanceof OutfitError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

export async function wearTogetherAction(personId: string, suggestionId: string, title: string): Promise<Result> {
  const me = await requirePerson();
  try {
    await wearBoard(me, personId, suggestionId, 0, title);
    revalidatePath("/today/together"); revalidatePath("/today"); revalidatePath("/fits");
    return { ok: true };
  } catch (e) {
    if (e instanceof OutfitError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

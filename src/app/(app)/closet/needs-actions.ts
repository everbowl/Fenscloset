"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { snoozeNeed } from "@/lib/closet/needs";
import { ProfileError } from "@/lib/profiles/service";

export type Result = { ok: true } | { ok: false; error: string };

/** Not now on a What's-needed row: hidden for the household's needSnoozeDays (Admin → Rules). */
export async function snoozeNeedAction(key: string): Promise<Result> {
  try {
    const person = await requirePerson();
    await snoozeNeed(person, key);
    revalidatePath("/closet");
    return { ok: true };
  } catch (e) {
    if (e instanceof ProfileError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

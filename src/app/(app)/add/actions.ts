"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { setAddTipsHidden } from "@/lib/tips";

/** "Don't show again" / "Show photo tips" on Add clothes. */
export async function setAddTipsHiddenAction(hidden: boolean): Promise<{ ok: true }> {
  const me = await requirePerson();
  await setAddTipsHidden(me, hidden);
  revalidatePath("/add");
  return { ok: true };
}

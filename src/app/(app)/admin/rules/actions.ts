"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/current";
import { setRule } from "@/lib/rules";
import { refitCutouts } from "@/lib/items/refit";

export type RuleState = { saved?: string; error?: string };

export async function saveRuleAction(_prev: RuleState, formData: FormData): Promise<RuleState> {
  await requireAdmin();
  const key = String(formData.get("key") ?? "");
  const value = String(formData.get("value") ?? "");
  try {
    await setRule(key, value);
    revalidatePath("/admin/rules");
    return { saved: key };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save." };
  }
}

export type RefitState = { done?: { checked: number; refit: number }; error?: string };

/** Admin maintenance: trim the empty margin on every cutout added before the trim fix. */
export async function refitPhotosAction(_prev: RefitState, _formData: FormData): Promise<RefitState> {
  await requireAdmin();
  try {
    const done = await refitCutouts();
    revalidatePath("/closet");
    return { done };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't refit." };
  }
}

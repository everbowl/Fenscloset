"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/current";
import { setRule } from "@/lib/rules";
import { refitCutouts } from "@/lib/items/refit";
import { untidyAll, type UntidyReport } from "@/lib/items/untidy";

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

export type UntidyState = { done?: UntidyReport; error?: string };

/** Admin maintenance: the pieces Tidy and Smooth touched that still wait for a fresh cutout (remove.bg ran out of credits mid-run, say). */
export async function untidyNowAction(_prev: UntidyState, _formData: FormData): Promise<UntidyState> {
  await requireAdmin();
  try {
    const done = await untidyAll({ log: (line) => console.log(line) });
    revalidatePath("/closet"); // not this page: the row stays up with its result until the next visit
    return { done };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't re-cut." };
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

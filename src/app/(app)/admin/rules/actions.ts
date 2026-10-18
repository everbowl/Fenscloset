"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/current";
import { setRule } from "@/lib/rules";

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

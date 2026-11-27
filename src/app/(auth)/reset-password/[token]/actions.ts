"use server";

import { redirect } from "next/navigation";
import { consumeResetToken } from "@/lib/auth/reset";
import { validateNewPassword } from "@/lib/auth/change-password";
import { signIn } from "@/lib/auth/current";

export type ResetState = { error?: string };

export async function resetPasswordAction(token: string, _prev: ResetState, formData: FormData): Promise<ResetState> {
  const password = String(formData.get("password") ?? "");
  const problem = validateNewPassword(password);
  if (problem) return { error: problem };
  const result = await consumeResetToken(token, password);
  if (!result.ok) return { error: "This link has expired or was already used. Request a new one." };
  await signIn(result.personId);
  redirect("/today");
}

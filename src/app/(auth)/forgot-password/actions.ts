"use server";

import { sendResetEmail } from "@/lib/auth/reset";

export type ForgotState = { done?: boolean; error?: string; email?: string };

export async function forgotPasswordAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@")) return { error: "Enter the email you use to sign in.", email };
  await sendResetEmail(email);
  return { done: true, email };
}

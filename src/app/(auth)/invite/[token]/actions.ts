"use server";

import { redirect } from "next/navigation";
import { acceptInvite } from "@/lib/auth/invite";
import { validateNewPassword } from "@/lib/auth/change-password";
import { signIn } from "@/lib/auth/current";

export type AcceptState = { error?: string };

export async function acceptInviteAction(token: string, _prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const problem = validateNewPassword(password);
  if (problem) return { error: problem };
  const result = await acceptInvite(token, { name, password, email: email || undefined });
  if (!result.ok) return { error: result.error };
  await signIn(result.personId);
  redirect("/today");
}

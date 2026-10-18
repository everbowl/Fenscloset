"use server";

import { redirect } from "next/navigation";
import { login } from "@/lib/auth/login";
import { signIn, getCurrentPerson } from "@/lib/auth/current";

export type LoginState = { error?: string; email?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };

  const result = await login(email, password);
  if (!result.ok) {
    return {
      email,
      error: result.reason === "no_password"
        ? "This account doesn't have a password yet. Use the invite link you were sent, or tap “Forgot password”."
        : "That email and password don't match.",
    };
  }
  await signIn(result.person.id, { usedDevPassword: result.usedDevPassword });
  if (result.person.mustChangePassword) redirect("/change-password");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/today");
}

export async function logoutAction() {
  const { signOut } = await import("@/lib/auth/current");
  await signOut();
  redirect("/login");
}

export async function redirectIfSignedIn() {
  const person = await getCurrentPerson();
  if (person) redirect(person.mustChangePassword ? "/change-password" : "/today");
}

"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { login, normalizeEmail } from "@/lib/auth/login";
import { signIn, getCurrentPerson } from "@/lib/auth/current";
import { checkRateLimit, clearRateLimit, clientIp, noteFailure, rateLimitKey, rateLimitMessage } from "@/lib/auth/rate-limit";
import { cookieSecure } from "@/lib/app-url";

export type LoginState = { error?: string; email?: string };

// One line for every way a sign-in fails: unknown address, no password yet, wrong password (review A S11; security item 3).
const FAILED = "That email and password don't match. Use Forgot password if you need a new one.";

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };

  const h = await headers();
  // Over plain http the phone drops the Secure session cookie, so the sign-in would look like it did nothing (review A
  // A4). Say so first, before a one-time password is spent on it.
  if (cookieSecure() && h.get("x-forwarded-proto") === "http") {
    return { email, error: `This page was opened over plain http, so a sign-in can't stick. Open ${process.env.APP_URL ?? "the https address"} instead.` };
  }
  // Five tries per address from one network, then a wait (review A S1).
  const key = rateLimitKey(clientIp(h), normalizeEmail(email));
  const gate = checkRateLimit(key);
  if (!gate.ok) return { email, error: rateLimitMessage(gate.minutesLeft) };

  const result = await login(email, password);
  if (!result.ok) {
    noteFailure(key);
    return { email, error: FAILED };
  }
  clearRateLimit(key);
  await signIn(result.person.id);
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

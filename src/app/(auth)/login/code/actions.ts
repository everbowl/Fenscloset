"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isAdmin, requirePerson, signIn } from "@/lib/auth/current";
import { createPhoneCode, redeemPhoneCode } from "@/lib/auth/phone-code";
import { checkRateLimit, clearRateLimit, clientIp, noteFailure, rateLimitKey, rateLimitMessage } from "@/lib/auth/rate-limit";
import { cookieSecure } from "@/lib/app-url";

export type CodeState = { error?: string };

/** From Settings, signed in: a code that signs this same person in on another phone for the next ten minutes. */
export async function createPhoneCodeAction(): Promise<{ ok: true; code: string; expiresAt: string; loginUrl: string } | { ok: false; error: string }> {
  const me = await requirePerson();
  if (!isAdmin(me)) return { ok: false, error: "Only admins can make a sign-in code." };
  if (me.mustChangePassword) return { ok: false, error: "Set your password first." };
  const { code, expiresAt } = createPhoneCode(me.id);
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return { ok: true, code, expiresAt: expiresAt.toISOString(), loginUrl: `${base}/login/code` };
}

/** From the other phone's "Have a code?" page: five guesses per network in fifteen minutes, like a password. */
export async function redeemPhoneCodeAction(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { error: "Type all six digits." };
  const h = await headers();
  if (cookieSecure() && h.get("x-forwarded-proto") === "http") {
    return { error: `This page was opened over plain http, so a sign-in can't stick. Open ${process.env.APP_URL ?? "the https address"} instead.` };
  }
  const key = rateLimitKey(clientIp(h), "phone-code");
  const gate = checkRateLimit(key);
  if (!gate.ok) return { error: rateLimitMessage(gate.minutesLeft) };
  const r = redeemPhoneCode(code);
  if (!r.ok) { noteFailure(key); return { error: "That code didn't work. Codes last 10 minutes and work once; ask for a new one on the first phone." }; }
  const person = await db.person.findUnique({ where: { id: r.personId }, select: { status: true, mustChangePassword: true } });
  if (!person || person.status === "removed") return { error: "That account can't sign in anymore." };
  clearRateLimit(key);
  await signIn(r.personId);
  redirect(person.mustChangePassword ? "/change-password" : "/today");
}

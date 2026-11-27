"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isAdmin, requirePerson, signIn } from "@/lib/auth/current";
import { createPhoneCode, redeemPhoneCode, voidAllPhoneCodes } from "@/lib/auth/phone-code";
import { clientKey, countFailures, recordAttempt, throttleRules, throttleStatus } from "@/lib/auth/rate-limit";
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

const CODE_FAILED = "That code didn't work. Codes last 10 minutes and work once; ask for a new one on the first phone.";

/**
 * From the other phone's "Have a code?" page. Wrong guesses back off per client like a password, and once the household's
 * guess budget for the window is spent every live code is voided (security item 6): a six-digit code cannot be guessed.
 */
export async function redeemPhoneCodeAction(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { error: "Type all six digits." };
  const h = await headers();
  if (cookieSecure() && h.get("x-forwarded-proto") === "http") {
    return { error: `This page was opened over plain http, so a sign-in can't stick. Open ${process.env.APP_URL ?? "the https address"} instead.` };
  }
  const client = clientKey(h);
  const gate = await throttleStatus("code", "code", client);
  if (!gate.ok) return { error: CODE_FAILED };
  const r = redeemPhoneCode(code);
  if (!r.ok) {
    await recordAttempt("code", "code", client, false);
    const rules = await throttleRules();
    if ((await countFailures("code", rules.authWindowMinutes * 60_000)) >= rules.codeGuessesBeforeReset) {
      voidAllPhoneCodes();
      return { error: "Too many wrong codes, so every code was voided. Ask for a new one on the first phone." };
    }
    return { error: CODE_FAILED };
  }
  const person = await db.person.findUnique({ where: { id: r.personId }, select: { status: true, mustChangePassword: true } });
  if (!person || person.status === "removed") return { error: "That account can't sign in anymore." };
  await recordAttempt("code", "code", client, true);
  await signIn(r.personId);
  redirect(person.mustChangePassword ? "/change-password" : "/today");
}

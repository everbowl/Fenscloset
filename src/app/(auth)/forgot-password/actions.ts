"use server";

import { headers } from "next/headers";
import { sendResetEmail, type ResetSendResult } from "@/lib/auth/reset";
import { checkRateLimit, clientIp, noteFailure, rateLimitKey, rateLimitMessage } from "@/lib/auth/rate-limit";

export type ForgotState = { done?: boolean; error?: string; email?: string };

export async function forgotPasswordAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@")) return { error: "Enter the email you use to sign in.", email };

  // Five reset emails per address from one network in fifteen minutes is plenty (review A S1).
  const key = rateLimitKey(clientIp(await headers()), email);
  const gate = checkRateLimit(key);
  if (!gate.ok) return { error: rateLimitMessage(gate.minutesLeft), email };
  noteFailure(key);

  let r: ResetSendResult;
  try {
    r = await sendResetEmail(email);
  } catch (e) {
    console.error("[forgot-password] sending threw", e);
    r = { sent: false, reason: "failed" };
  }
  // Whether the address is known stays private; whether the site can send mail at all does not (review A A3).
  if (!r.sent && r.reason === "not_configured") return { error: "Email isn't set up on the site yet — ask Jeff.", email };
  if (!r.sent && r.reason === "failed") return { error: "The email couldn't be sent just now. Try again in a minute.", email };
  return { done: true, email };
}

"use server";

import { headers } from "next/headers";
import { sendResetEmail, type ResetSendResult } from "@/lib/auth/reset";
import { accountKey, clientKey, recordAttempt, sendAllowed } from "@/lib/auth/rate-limit";

export type ForgotState = { done?: boolean; error?: string; email?: string };

export async function forgotPasswordAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@")) return { error: "Enter the email you use to sign in.", email };

  // One mail per address per cooldown and a few per hour, a ceiling per client (security item 6). Past a limit nothing is
  // sent and the answer is the same "done": whether an address exists, or a limit was hit, stays private.
  const client = clientKey(await headers());
  const account = accountKey(email);
  if (!(await sendAllowed("forgot", account, client))) return { done: true, email };

  let r: ResetSendResult;
  try {
    r = await sendResetEmail(email);
  } catch (e) {
    console.error("[forgot-password] sending threw", e);
    r = { sent: false, reason: "failed" };
  }
  if (r.sent || (!r.sent && r.reason === "unknown")) await recordAttempt("forgot", account, client, true); // counts the same for a known and an unknown address
  // Whether the address is known stays private; whether the site can send mail at all does not (review A A3).
  if (!r.sent && r.reason === "not_configured") return { error: "Email isn't set up on the site yet — ask an admin.", email };
  if (!r.sent && r.reason === "failed") return { error: "The email couldn't be sent just now. Try again in a minute.", email };
  return { done: true, email };
}

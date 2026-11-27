"use server";

import { redirect } from "next/navigation";
import { requirePerson } from "@/lib/auth/current";
import { setPassword, validateNewPassword } from "@/lib/auth/change-password";
import { verifyPassword } from "@/lib/auth/password";
import { renderEmail, sendEmail } from "@/lib/email";
import { db } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { cookies } from "next/headers";
import { hashToken } from "@/lib/auth/tokens";

export type ChangePasswordState = { error?: string };

export async function changePasswordAction(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const person = await requirePerson();
  const password = String(formData.get("password") ?? "");
  const problem = validateNewPassword(password);
  if (problem) return { error: problem };
  // Someone holding an unlocked phone or a stolen cookie must not be able to lock the real person out (security item 14):
  // the current password is required, except in the forced-change state that only follows a reset link or an invite.
  if (!person.mustChangePassword) {
    const current = String(formData.get("current") ?? "");
    const ok = person.passwordHash ? await verifyPassword(person.passwordHash, current) : false;
    if (!ok) return { error: "That isn't your current password. Forgot it? Sign out and use Forgot password." };
  }

  await setPassword(person.id, password);
  if (person.email) {
    const { html, text } = renderEmail({ heading: "Your password was changed", body: "Your Fen's Closet password was just changed and every other phone was signed out. If this wasn't you, use Forgot password on the sign-in page right away." });
    sendEmail({ to: person.email, subject: "Your Fen's Closet password was changed", html, text }).catch(() => undefined);
  }
  // Keep this session, drop every other one.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  await db.session.deleteMany({ where: { personId: person.id, NOT: token ? { tokenHash: hashToken(token) } : undefined } });
  redirect("/today");
}

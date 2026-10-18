import { db } from "@/lib/db";
import { generateToken, hashToken } from "@/lib/auth/tokens";
import { normalizeEmail } from "@/lib/auth/login";
import { setPassword } from "@/lib/auth/change-password";
import { destroyAllSessionsFor } from "@/lib/auth/session";
import { appUrl, renderEmail, sendEmail } from "@/lib/email";

export const RESET_TTL_MS = 60 * 60 * 1000; // 60 minutes

/** Creates a single-use reset token for a known email. Returns null (silently) for unknown emails. */
export async function createResetToken(emailRaw: string): Promise<{ token: string; personId: string } | null> {
  const email = normalizeEmail(emailRaw);
  const person = await db.person.findUnique({ where: { email } });
  if (!person || person.status === "removed") return null;
  const token = generateToken();
  await db.passwordResetToken.create({
    data: { personId: person.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
  });
  return { token, personId: person.id };
}

export async function sendResetEmail(emailRaw: string): Promise<void> {
  const created = await createResetToken(emailRaw);
  if (!created) return;
  const url = appUrl(`/reset-password/${created.token}`);
  const { html, text } = renderEmail({
    heading: "Reset your password",
    body: "Tap the button to choose a new password. This link works once and expires in 60 minutes. If you didn't ask for this, ignore it.",
    cta: { label: "Choose a new password", url },
  });
  await sendEmail({ to: normalizeEmail(emailRaw), subject: "Reset your Fen's Closet password", html, text });
}

export async function peekResetToken(token: string): Promise<{ valid: boolean; email?: string | null }> {
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { person: true } });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return { valid: false };
  return { valid: true, email: row.person.email };
}

/** Sets the new password, burns the token, and signs the person out everywhere else. */
export async function consumeResetToken(token: string, newPassword: string): Promise<{ ok: true; personId: string } | { ok: false }> {
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return { ok: false };
  const claimed = await db.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) return { ok: false }; // lost a race with a concurrent use
  await setPassword(row.personId, newPassword);
  await db.person.update({ where: { id: row.personId }, data: { devPasswordActive: false } });
  await destroyAllSessionsFor(row.personId);
  return { ok: true, personId: row.personId };
}

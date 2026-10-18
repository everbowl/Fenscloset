import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { DEV_ADMIN_EMAIL, isDevMode } from "@/lib/auth/dev-mode";
import type { Person } from "@/generated/prisma/client";

export type LoginResult =
  | { ok: true; person: Person; usedDevPassword: boolean }
  | { ok: false; reason: "invalid" | "no_password" };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Verifies credentials. The one-time DEV password is consumed here: after a successful DEV login the
 * stored hash is cleared, so 0535 can never log in twice, and `mustChangePassword` forces a new one.
 */
export async function login(emailRaw: string, password: string): Promise<LoginResult> {
  const email = normalizeEmail(emailRaw);
  const person = await db.person.findUnique({ where: { email } });
  if (!person || person.status === "removed") return { ok: false, reason: "invalid" };
  // A consumed DEV password leaves no hash behind; that must look like an ordinary wrong password.
  if (!person.passwordHash) return { ok: false, reason: person.devPasswordUsedAt ? "invalid" : "no_password" };

  // A DEV password that is still "active" is only honoured while DEV_MODE is on.
  if (person.devPasswordActive && (!isDevMode() || person.email !== DEV_ADMIN_EMAIL)) {
    return { ok: false, reason: "invalid" };
  }

  const good = await verifyPassword(person.passwordHash, password);
  if (!good) return { ok: false, reason: "invalid" };

  if (person.devPasswordActive) {
    const now = new Date();
    const updated = await db.person.update({
      where: { id: person.id },
      data: { devPasswordActive: false, devPasswordUsedAt: now, passwordHash: null, mustChangePassword: true, status: "active" },
    });
    console.error(`[DEV-MODE] One-time password 0535 used by ${person.email} at ${now.toISOString()}. It is now disabled.`);
    return { ok: true, person: updated, usedDevPassword: true };
  }

  return { ok: true, person, usedDevPassword: false };
}

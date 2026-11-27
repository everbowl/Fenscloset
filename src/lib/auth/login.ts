import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { DEV_ADMIN_EMAIL, isDevMode } from "@/lib/auth/dev-mode";
import { forgetDevBanner } from "@/lib/auth/dev-banner";
import type { Person } from "@/generated/prisma/client";

export type LoginReason = "invalid" | "no_password" | "dev_used";
export type LoginResult =
  | { ok: true; person: Person; usedDevPassword: boolean }
  | { ok: false; reason: LoginReason };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type PasswordFlags = Pick<Person, "passwordHash" | "devPasswordActive" | "devPasswordUsedAt" | "mustChangePassword">;

/**
 * the one-time password was used and no real password has replaced it yet. The consumed hash stays on the row until the new password is
 * saved (review A A2), so the account is never without one; it just never verifies again.
 */
export function devPasswordConsumed(p: PasswordFlags): boolean {
  return !p.devPasswordActive && Boolean(p.devPasswordUsedAt) && p.mustChangePassword;
}

/** A password this person can sign in with right now. */
export function hasUsablePassword(p: PasswordFlags): boolean {
  return Boolean(p.passwordHash) && !devPasswordConsumed(p);
}

// An unknown address is checked against this throwaway hash, so it takes as long as a wrong password (review A S11).
let decoy: Promise<string> | null = null;
function decoyHash(): Promise<string> {
  return (decoy ??= hashPassword(randomBytes(16).toString("hex")));
}

/**
 * Verifies credentials. The one-time DEV password is consumed here: the first phone to sign in with the one-time password claims it
 * (a conditional update, so two phones cannot both win; review A S2), after which the account is forced to a new
 * password and the one-time password answers "dev_used" until that password is saved.
 */
export async function login(emailRaw: string, password: string): Promise<LoginResult> {
  const email = normalizeEmail(emailRaw);
  const person = await db.person.findUnique({ where: { email } });
  if (!person || person.status === "removed") {
    await verifyPassword(await decoyHash(), password);
    return { ok: false, reason: "invalid" };
  }
  if (!person.passwordHash) return { ok: false, reason: "no_password" };
  if (devPasswordConsumed(person)) return { ok: false, reason: "dev_used" };

  // A DEV password that is still "active" is only honoured while DEV_MODE is on.
  if (person.devPasswordActive && (!isDevMode() || !DEV_ADMIN_EMAIL || person.email !== DEV_ADMIN_EMAIL)) {
    return { ok: false, reason: "invalid" };
  }

  const good = await verifyPassword(person.passwordHash, password);
  if (!good) return { ok: false, reason: "invalid" };

  if (person.devPasswordActive) {
    const now = new Date();
    const claimed = await db.person.updateMany({
      where: { id: person.id, devPasswordActive: true },
      data: { devPasswordActive: false, devPasswordUsedAt: now, mustChangePassword: true, status: "active" },
    });
    forgetDevBanner();
    if (claimed.count !== 1) return { ok: false, reason: "dev_used" }; // another phone got there first
    const updated = await db.person.findUniqueOrThrow({ where: { id: person.id } });
    console.error(`[DEV-MODE] The one-time password was used by person ${person.id} at ${now.toISOString()}. It is now disabled.`);
    return { ok: true, person: updated, usedDevPassword: true };
  }

  return { ok: true, person, usedDevPassword: false };
}

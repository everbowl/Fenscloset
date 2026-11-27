import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { Person } from "@/generated/prisma/client";

export type LoginResult = { ok: true; person: Person } | { ok: false };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A password this person can sign in with right now. */
export function hasUsablePassword(p: Pick<Person, "passwordHash">): boolean {
  return Boolean(p.passwordHash);
}

// An unknown address, or an account with no password yet, is checked against this throwaway hash, so every failure takes
// as long as a wrong password (review A S11).
let decoy: Promise<string> | null = null;
function decoyHash(): Promise<string> {
  return (decoy ??= hashPassword(randomBytes(16).toString("hex")));
}

/**
 * Verifies credentials. Every failure is the same answer, whether the address is unknown, the account has no password yet
 * or the password is wrong (security item 3): nothing here says which. The retired one-time dev password has no path left;
 * the first admin of an empty database comes from `npm run admin:bootstrap` and a reset link.
 */
export async function login(emailRaw: string, password: string): Promise<LoginResult> {
  const email = normalizeEmail(emailRaw);
  const person = await db.person.findUnique({ where: { email } });
  const hash = person && person.status !== "removed" ? person.passwordHash : null;
  const good = await verifyPassword(hash ?? (await decoyHash()), password);
  if (!person || !hash || !good) return { ok: false };
  return { ok: true, person };
}

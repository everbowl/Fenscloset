import { createHash, randomInt } from "node:crypto";

/*
 * "Sign in on another phone" (docs/redesign-2026-11-23.md §4, Auth): an admin shows a six-digit code in Settings, types it
 * on the second phone's sign-in page, and that phone is signed in as the SAME person. A code lives ten minutes and works
 * once. Codes are kept in the process, not the database: a restart only means asking for a new one, and nothing about a
 * code outlives the ten minutes anyway. Only the hash of a code is kept, and a code dies after a few wrong guesses at it.
 */
export const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_DIGITS = 6;

type Entry = { personId: string; expiresAt: number };
const live = new Map<string, Entry>(); // sha256(code) → who it signs in

function hash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function prune(now: number) {
  for (const [k, e] of live) if (e.expiresAt <= now) live.delete(k);
}

/** A fresh code for this person; any code they already had stops working. */
export function createPhoneCode(personId: string): { code: string; expiresAt: Date } {
  const now = Date.now();
  prune(now);
  for (const [k, e] of live) if (e.personId === personId) live.delete(k);
  let code = "";
  do { code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0"); } while (live.has(hash(code)));
  const expiresAt = now + CODE_TTL_MS;
  live.set(hash(code), { personId, expiresAt });
  return { code, expiresAt: new Date(expiresAt) };
}

/** Spends a code. Right or wrong, it answers in about the same time; a right code is gone the moment it is used. */
export function redeemPhoneCode(raw: string): { ok: true; personId: string } | { ok: false } {
  const now = Date.now();
  prune(now);
  const code = raw.replace(/\D/g, "");
  if (code.length !== CODE_DIGITS) return { ok: false };
  const key = hash(code);
  const e = live.get(key);
  if (!e || e.expiresAt <= now) return { ok: false };
  live.delete(key);
  return { ok: true, personId: e.personId };
}

/** Tests only. */
export function resetPhoneCodes(): void {
  live.clear();
}

import { db } from "@/lib/db";
import { DEV_ADMIN_EMAIL, isDevMode } from "@/lib/auth/dev-mode";

/*
 * Whether the one-time DEV password is still live, for the black DEV strip. Every layout asks on every request, so the
 * answer is kept for a few seconds (review A P7); the moment the one-time password is used or a real password lands, the keeper is told.
 */
const KEEP_MS = 3_000;
let kept: { active: boolean; at: number } | null = null;

export async function devPasswordLive(): Promise<boolean> {
  if (!isDevMode() || !DEV_ADMIN_EMAIL) return false;
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.active;
  const admin = await db.person.findUnique({ where: { email: DEV_ADMIN_EMAIL }, select: { devPasswordActive: true } });
  kept = { active: Boolean(admin?.devPasswordActive), at: Date.now() };
  return kept.active;
}

/** Call after anything that turns the DEV password on or off. */
export function forgetDevBanner(): void {
  kept = null;
}

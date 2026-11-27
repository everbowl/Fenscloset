import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getRuleNumbers } from "@/lib/rules";

/**
 * Slows a stranger down without ever locking the family out (security item 6, FC-03). Every attempt lands in AuthAttempt
 * under two hashed keys, the account and the client; after N failures in the window the next try waits, and each further
 * failure doubles the wait up to a cap, counted from the last failure. A try made during the wait is refused with the same
 * words as a wrong password and is not recorded, so it never extends the wait. A sign-in or a used reset link clears the
 * account's count. Reset mails and invite links have a cooldown and ceilings instead. Every number is an admin-editable
 * Rule with a floor enforced here, so no value can switch a limit off.
 */
export type AttemptKind = "login" | "forgot" | "code" | "invite_send";

const RULE_FALLBACKS = {
  authFailuresBeforeWait: 5, authWindowMinutes: 15, authFirstWaitSeconds: 30, authMaxWaitMinutes: 15, authClientFailuresPerHour: 60,
  forgotPerAccountMinutes: 3, forgotPerAccountPerHour: 4, forgotPerClientPerHour: 20,
  inviteResendMinutes: 2, inviteSendsPerDay: 10, codeGuessesBeforeReset: 10,
};
export type ThrottleRuleKey = keyof typeof RULE_FALLBACKS;
/** Floors: an admin can tighten a limit as far as they like, never loosen it past these. */
export const THROTTLE_MINIMUMS: Record<ThrottleRuleKey, number> = {
  authFailuresBeforeWait: 3, authWindowMinutes: 5, authFirstWaitSeconds: 10, authMaxWaitMinutes: 1, authClientFailuresPerHour: 20,
  forgotPerAccountMinutes: 1, forgotPerAccountPerHour: 2, forgotPerClientPerHour: 5,
  inviteResendMinutes: 1, inviteSendsPerDay: 3, codeGuessesBeforeReset: 5,
};
export const THROTTLE_RULE_KEYS = Object.keys(RULE_FALLBACKS) as ThrottleRuleKey[];

export async function throttleRules(): Promise<Record<ThrottleRuleKey, number>> {
  const r = await getRuleNumbers(RULE_FALLBACKS);
  for (const k of THROTTLE_RULE_KEYS) r[k] = Math.max(THROTTLE_MINIMUMS[k], Math.floor(r[k]));
  return r;
}

function digest(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

/**
 * The client as the trusted edge reports it: the right-most X-Forwarded-For hop, the one the proxy in front of the app
 * appended. The left-most hops are whatever the client chose to send, so they never count. No header at all (tests, a
 * direct connection) lands every request in one shared "unknown" bucket.
 */
export function clientKey(headers: { get(name: string): string | null }): string {
  const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = hops[hops.length - 1];
  return ip ? digest(ip) : "unknown";
}

/** The account side of a key: an address, a phone number or an invite's contact, hashed after normalizing. */
export function accountKey(s: string): string {
  return digest(s.trim().toLowerCase());
}

function waitLeft(failures: { createdAt: Date }[], before: number, first: number, capSeconds: number, now: number): number {
  if (failures.length < before) return 0;
  const waitMs = Math.min(first * 2 ** (failures.length - before), capSeconds) * 1000;
  return Math.max(0, failures[0].createdAt.getTime() + waitMs - now);
}

/** May this account, from this client, try to sign in (or redeem a code) right now? */
export async function throttleStatus(kind: AttemptKind, account: string, client: string, now = Date.now()): Promise<{ ok: true } | { ok: false; waitSeconds: number }> {
  const r = await throttleRules();
  const cap = r.authMaxWaitMinutes * 60;
  const [acct, cli] = await Promise.all([
    db.authAttempt.findMany({ where: { kind, accountKey: account, ok: false, createdAt: { gt: new Date(now - r.authWindowMinutes * 60_000) } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.authAttempt.findMany({ where: { kind, ipKey: client, ok: false, createdAt: { gt: new Date(now - 3_600_000) } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const left = Math.max(
    waitLeft(acct, r.authFailuresBeforeWait, r.authFirstWaitSeconds, cap, now),
    waitLeft(cli, r.authClientFailuresPerHour, r.authFirstWaitSeconds, cap, now),
  );
  return left > 0 ? { ok: false, waitSeconds: Math.ceil(left / 1000) } : { ok: true };
}

/** Records one attempt. A success clears the account's failures for that kind. Rows older than a day are pruned here. */
export async function recordAttempt(kind: AttemptKind, account: string, client: string, ok: boolean): Promise<void> {
  if (ok) await db.authAttempt.deleteMany({ where: { kind, accountKey: account, ok: false } });
  await db.authAttempt.create({ data: { kind, accountKey: account, ipKey: client, ok } });
  await db.authAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } } });
}

/** A completed password reset is a sign-in: the account's sign-in failures go, so a stranger hammering an address cannot keep its owner out. */
export async function clearFailures(kind: AttemptKind, account: string): Promise<void> {
  await db.authAttempt.deleteMany({ where: { kind, accountKey: account, ok: false } });
}

/** Failures of one kind in the window, across every account (the second-phone code has no account of its own). */
export async function countFailures(kind: AttemptKind, windowMs: number, now = Date.now()): Promise<number> {
  return db.authAttempt.count({ where: { kind, ok: false, createdAt: { gt: new Date(now - windowMs) } } });
}

/**
 * May a reset mail or an invite link go out? One per account per cooldown, a ceiling per account (an hour for reset
 * mails, a day for invites) and, for reset mails, a ceiling per client per hour. The caller answers the same way whether
 * or not something was sent, so a stranger learns nothing.
 */
export async function sendAllowed(kind: "forgot" | "invite_send", account: string, client: string, now = Date.now()): Promise<boolean> {
  const r = await throttleRules();
  const cfg = kind === "forgot"
    ? { cooldownMs: r.forgotPerAccountMinutes * 60_000, perAccount: r.forgotPerAccountPerHour, accountWindowMs: 3_600_000, perClient: r.forgotPerClientPerHour }
    : { cooldownMs: r.inviteResendMinutes * 60_000, perAccount: r.inviteSendsPerDay, accountWindowMs: 86_400_000, perClient: Infinity };
  const last = await db.authAttempt.findFirst({ where: { kind, accountKey: account, ok: true }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last && now - last.createdAt.getTime() < cfg.cooldownMs) return false;
  const perAccount = await db.authAttempt.count({ where: { kind, accountKey: account, ok: true, createdAt: { gt: new Date(now - cfg.accountWindowMs) } } });
  if (perAccount >= cfg.perAccount) return false;
  if (Number.isFinite(cfg.perClient)) {
    const perClient = await db.authAttempt.count({ where: { kind, ipKey: client, ok: true, createdAt: { gt: new Date(now - 3_600_000) } } });
    if (perClient >= cfg.perClient) return false;
  }
  return true;
}

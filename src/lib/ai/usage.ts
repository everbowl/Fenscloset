import { db } from "@/lib/db";
import { getRuleNumbers, getTimezone } from "@/lib/rules";

/**
 * Spend caps on every paid AI call (security item 8, FC-05). Each call is charged before it is made: one row per person,
 * provider and household day, incremented atomically; past the person's daily cap, or the household's ceiling across
 * everyone, the call does not happen and the caller gets a friendly error. Background work (shop sweeps, imports with no
 * signed-in person) charges the household bucket. Every cap is an admin-editable Rule with a floor of 1, so no value means
 * "unlimited".
 */
export type AiProvider = "claude" | "tryon" | "removebg" | "shop" | "googleimage";

export const HOUSEHOLD_BUCKET = "household";

const CAP_FALLBACKS = { aiPerPersonClaude: 150, aiPerPersonTryOn: 20, aiPerPersonRemoveBg: 150, aiPerPersonShop: 100, aiPerPersonGoogleImage: 20, aiHouseholdPerDay: 500 };
export type AiCapKey = keyof typeof CAP_FALLBACKS;
export const AI_CAP_KEYS = Object.keys(CAP_FALLBACKS) as AiCapKey[];
export const AI_CAP_MINIMUM = 1;
const CAP_FOR: Record<AiProvider, AiCapKey> = { claude: "aiPerPersonClaude", tryon: "aiPerPersonTryOn", removebg: "aiPerPersonRemoveBg", shop: "aiPerPersonShop", googleimage: "aiPerPersonGoogleImage" };

export class AiCapError extends Error {
  readonly code = "ai_cap" as const;
  constructor(public readonly scope: "person" | "household") {
    super(scope === "household"
      ? "Today's AI allowance for the household is used up. An admin can raise it under Rules, or try again tomorrow."
      : "Today's AI allowance is used up. An admin can raise it under Rules, or try again tomorrow.");
    this.name = "AiCapError";
  }
}
export function isAiCapError(e: unknown): e is AiCapError {
  return e instanceof AiCapError || (e instanceof Error && e.name === "AiCapError");
}

export async function aiCaps(): Promise<Record<AiCapKey, number>> {
  const r = await getRuleNumbers(CAP_FALLBACKS);
  for (const k of AI_CAP_KEYS) r[k] = Math.max(AI_CAP_MINIMUM, Math.floor(r[k]));
  return r;
}

/** The household's day, YYYY-MM-DD in its time zone: a cap resets at the family's midnight, not the server's. */
export function dayKey(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The signed-in person when a request is running; null in a background job or a test. */
async function requestPersonId(): Promise<string | null> {
  try {
    const { getCurrentPerson } = await import("@/lib/auth/current");
    return (await getCurrentPerson())?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Charges one paid call to `provider` for `personId` (else the signed-in person, else the household bucket). Throws
 * AiCapError, and charges nothing, when the household's day is used up or the person's cap for that provider is.
 */
export async function chargeAi(provider: AiProvider, personId?: string): Promise<void> {
  const who = personId ?? (await requestPersonId()) ?? HOUSEHOLD_BUCKET;
  const [caps, tz] = await Promise.all([aiCaps(), getTimezone()]);
  const day = dayKey(tz);
  const household = await db.aiUsage.aggregate({ _sum: { count: true }, where: { day } });
  if ((household._sum.count ?? 0) >= caps.aiHouseholdPerDay) throw new AiCapError("household");
  const row = await db.aiUsage.upsert({
    where: { personId_provider_day: { personId: who, provider, day } },
    update: { count: { increment: 1 } },
    create: { personId: who, provider, day, count: 1 },
  });
  if (row.count > caps[CAP_FOR[provider]]) {
    await db.aiUsage.update({ where: { id: row.id }, data: { count: { decrement: 1 } } });
    throw new AiCapError("person");
  }
}

/** Midnight at the start of the household's next day: when a paused import may try again. */
export async function nextHouseholdMidnight(now = new Date()): Promise<Date> {
  const tz = await getTimezone();
  const today = dayKey(tz, now);
  // Walk forward in hours until the day key changes, then back to the first minute of it (no date library needed).
  let t = now.getTime();
  while (dayKey(tz, new Date(t)) === today) t += 3_600_000;
  while (dayKey(tz, new Date(t - 60_000)) !== today) t -= 60_000;
  return new Date(t + 5 * 60_000); // five minutes in, past any clock drift
}

import { isDevMode } from "@/lib/auth/dev-mode";

/**
 * SMS via Twilio's REST API (no SDK needed for one endpoint). Requires TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER. Without them it reports not-sent.
 */
export function smsConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (/^\+\d{10,15}$/.test(digits)) return digits;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}

const SEND_TIMEOUT_MS = 10_000;

/** Never throws: a network error or a slow Twilio comes back as { sent: false } within ten seconds (review A P9). */
export async function sendSms(to: string, body: string): Promise<{ sent: boolean; error?: string }> {
  if (!smsConfigured()) {
    // The text carries a sign-in link: printed only while DEV_MODE is on, never in a production log (review A A3).
    if (isDevMode()) console.info(`[sms:dry-run]\n${body}`);
    else console.info("[sms] Twilio is not set up; nothing was sent.");
    return { sent: false, error: "Texting isn't set up on the site yet." };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN!}`).toString("base64");
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER!, Body: body }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[sms] Twilio error", res.status, text);
      return { sent: false, error: `Twilio refused the message (${res.status}).` };
    }
    return { sent: true };
  } catch (e) {
    console.error("[sms] Twilio call threw", e);
    return { sent: false, error: "The texting service didn't answer. Try again in a minute." };
  }
}

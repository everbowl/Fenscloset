/**
 * SMS via Twilio's REST API (no SDK needed for one endpoint). Requires TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER. Without them it logs and reports not-sent.
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

export async function sendSms(to: string, body: string): Promise<{ sent: boolean; error?: string }> {
  if (!smsConfigured()) {
    console.info(`[sms:dry-run] to=${to}\n${body}`);
    return { sent: false, error: "SMS isn't set up yet" };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN!}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER!, Body: body }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[sms] Twilio error", res.status, text);
    return { sent: false, error: `Twilio refused the message (${res.status}).` };
  }
  return { sent: true };
}

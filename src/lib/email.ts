import { Resend } from "resend";
import { appUrl } from "@/lib/app-url";
import { isDevMode } from "@/lib/auth/dev-mode";

export { appUrl }; // the one place that builds absolute links; re-exported for the auth callers

export type EmailMessage = { to: string; subject: string; html: string; text: string };

/** True when the site can send email at all (RESEND_API_KEY is set). */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

const SEND_TIMEOUT_MS = 10_000;

/**
 * Sends through Resend when RESEND_API_KEY is set. Otherwise reports not-sent; the message itself (it carries a sign-in
 * link) is only printed while DEV_MODE is on, never in a production log (review A A3). Never throws: a provider that
 * hangs or fails comes back as { sent: false } after ten seconds at most (review A P9).
 */
export async function sendEmail(msg: EmailMessage): Promise<{ sent: boolean; id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Fen's Closet <onboarding@resend.dev>";
  if (!key) {
    if (isDevMode()) console.info(`[email:dry-run] subject="${msg.subject}"\n${msg.text}`);
    else console.info("[email] RESEND_API_KEY is not set; nothing was sent.");
    return { sent: false, error: "Email isn't set up on the site yet." };
  }
  try {
    const resend = new Resend(key);
    const { data, error } = await resend.emails.send(
      { from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text },
      { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) },
    );
    if (error) {
      console.error("[email] send failed", error);
      return { sent: false, error: error.message };
    }
    return { sent: true, id: data?.id };
  } catch (e) {
    console.error("[email] send threw", e);
    return { sent: false, error: "The email service didn't answer. Try again in a minute." };
  }
}

/** Text that is safe inside HTML (review A S9: the heading carries a name an admin typed). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Minimal, mobile-friendly transactional template. */
export function renderEmail({ heading, body, cta }: { heading: string; body: string; cta?: { label: string; url: string } }) {
  const h = escapeHtml(heading), b = escapeHtml(body);
  const button = cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:14px 22px;border-radius:999px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600">${escapeHtml(cta.label)}</a></p><p style="color:#5a5a57;font-size:13px">Or copy this link: ${escapeHtml(cta.url)}</p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0b0b0b"><div style="max-width:480px;margin:0 auto;padding:32px 20px"><p style="font-size:13px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#0b0b0b;margin:0 0 20px">Fen's Closet</p><h1 style="font-weight:600;font-size:26px;margin:0 0 12px">${h}</h1><p style="font-size:16px;line-height:1.5;margin:0">${b}</p>${button}</div></body></html>`;
  const text = `${heading}\n\n${body}${cta ? `\n\n${cta.label}: ${cta.url}` : ""}`;
  return { html, text };
}

import { Resend } from "resend";

export type EmailMessage = { to: string; subject: string; html: string; text: string };

/**
 * Sends through Resend when RESEND_API_KEY is set. Otherwise logs the message so local dev and tests
 * still show what would have gone out. Returns false when nothing was actually delivered.
 */
export async function sendEmail(msg: EmailMessage): Promise<{ sent: boolean; id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Fen's Closet <onboarding@resend.dev>";
  if (!key) {
    console.info(`[email:dry-run] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    return { sent: false, error: "RESEND_API_KEY is not set" };
  }
  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({ from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
  if (error) {
    console.error("[email] send failed", error);
    return { sent: false, error: error.message };
  }
  return { sent: true, id: data?.id };
}

export function appUrl(path: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}

/** Minimal, mobile-friendly transactional template. */
export function renderEmail({ heading, body, cta }: { heading: string; body: string; cta?: { label: string; url: string } }) {
  const button = cta
    ? `<p style="margin:24px 0"><a href="${cta.url}" style="display:inline-block;background:#b45309;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${cta.label}</a></p><p style="color:#78716c;font-size:13px">Or copy this link: ${cta.url}</p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#faf8f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1917"><div style="max-width:480px;margin:0 auto;padding:32px 20px"><p style="font-size:14px;color:#78716c;margin:0 0 16px">Fen's Closet</p><h1 style="font-size:22px;margin:0 0 12px">${heading}</h1><p style="font-size:16px;line-height:1.5;margin:0">${body}</p>${button}</div></body></html>`;
  const text = `${heading}\n\n${body}${cta ? `\n\n${cta.label}: ${cta.url}` : ""}`;
  return { html, text };
}

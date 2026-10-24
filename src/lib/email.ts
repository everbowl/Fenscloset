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
    ? `<p style="margin:24px 0"><a href="${cta.url}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:14px 22px;font-family:Menlo,Consolas,monospace;font-size:12px;letter-spacing:0.16em;text-transform:uppercase">${cta.label}</a></p><p style="color:#6b6b6b;font-size:12px">Or copy this link: ${cta.url}</p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f2f0eb;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#000"><div style="max-width:480px;margin:0 auto;padding:32px 20px"><p style="font-family:Menlo,Consolas,monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#000;margin:0 0 20px">Fen's Closet</p><h1 style="font-family:Georgia,serif;font-weight:400;font-size:28px;margin:0 0 12px">${heading}</h1><p style="font-size:16px;line-height:1.5;margin:0">${body}</p>${button}</div></body></html>`;
  const text = `${heading}\n\n${body}${cta ? `\n\n${cta.label}: ${cta.url}` : ""}`;
  return { html, text };
}

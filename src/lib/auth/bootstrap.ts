import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth/login";
import { createResetToken, sendResetEmail } from "@/lib/auth/reset";
import { appUrl } from "@/lib/email";

export type BootstrapResult = { ok: true; personId: string; link?: string } | { ok: false; reason: string };

/**
 * The first admin of a database that has none (security item 3). Finds or creates the person as an admin with no
 * password and hands them a single-use, 60-minute reset link: by e-mail, or returned here with `print` for a machine
 * without mail. Refuses while any admin with a password exists; a locked-out admin is then reset by the other admin from
 * the People page, never by this.
 */
export async function bootstrapAdmin(emailRaw: string, opts: { print?: boolean } = {}): Promise<BootstrapResult> {
  const email = normalizeEmail(emailRaw);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: "that is not an e-mail address" };
  const armed = await db.person.count({ where: { role: "admin", status: { not: "removed" }, passwordHash: { not: null } } });
  if (armed > 0) return { ok: false, reason: "an admin with a password already exists; use Forgot password, or have that admin send a reset link from People" };
  const existing = await db.person.findUnique({ where: { email } });
  const person = existing
    ? await db.person.update({ where: { id: existing.id }, data: { role: "admin" } })
    : await db.person.create({ data: { name: email.split("@")[0], email, role: "admin", status: "invited" } });
  if (!(await db.closet.findFirst({ where: { ownerId: person.id, kind: "personal" } }))) {
    await db.closet.create({ data: { name: `${person.name}'s closet`, kind: "personal", ownerId: person.id } });
  }
  if (opts.print) {
    const created = await createResetToken(email);
    if (!created) return { ok: false, reason: "no reset token could be made for that address" };
    return { ok: true, personId: person.id, link: appUrl(`/reset-password/${created.token}`) };
  }
  const sent = await sendResetEmail(email);
  if (!sent.sent) return { ok: false, reason: sent.reason === "not_configured" ? "e-mail is not set up on this machine (RESEND_API_KEY); run again with --print" : `the e-mail could not be sent (${sent.reason})` };
  return { ok: true, personId: person.id };
}

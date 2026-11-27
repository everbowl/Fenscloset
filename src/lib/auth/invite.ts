import { db } from "@/lib/db";
import { generateToken, hashToken } from "@/lib/auth/tokens";
import { normalizeEmail } from "@/lib/auth/login";
import { hashPassword } from "@/lib/auth/password";
import { appUrl, renderEmail, sendEmail } from "@/lib/email";
import { normalizePhone, sendSms } from "@/lib/sms";
import type { Role } from "@/generated/prisma/client";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  role: Role;
  guardianIds?: string[];
  createdById: string;
  /** Existing person to attach (e.g. seeded family member who hasn't set a password yet). */
  personId?: string;
};

/** The parent admins among `ids`: only an active admin can be a minor's guardian (review A S7). */
async function activeAdminIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const admins = await db.person.findMany({ where: { id: { in: ids }, role: "admin", status: { not: "removed" } }, select: { id: true } });
  return admins.map((a) => a.id);
}

/**
 * Creates an invite. If personId is given, the invite activates that existing person instead of creating one. The
 * email and phone on the invite are applied to that person when they accept, not now, so a typo cannot replace the
 * address they sign in with today (review A S7).
 */
export async function createInvite(input: InviteInput): Promise<{ token: string; url: string; inviteId: string }> {
  const name = input.name.trim();
  if (!name) throw new Error("Give them a name.");
  const email = input.email ? normalizeEmail(input.email) : null;
  if (email && !email.includes("@")) throw new Error("That email doesn't look right.");
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone) throw new Error("That phone number doesn't look right. Use 10 digits.");
  const guardianIds = await activeAdminIds(input.guardianIds ?? []);
  if (input.role === "minor" && !guardianIds.length) throw new Error("A minor needs at least one parent admin.");
  if (email) {
    const taken = await db.person.findUnique({ where: { email }, select: { id: true } });
    if (taken && taken.id !== input.personId) throw new Error("That email already belongs to someone in the family.");
  }

  const token = generateToken();
  const invite = await db.inviteToken.create({
    data: {
      tokenHash: hashToken(token),
      name, email, phone, role: input.role,
      guardianIds: input.role === "minor" ? guardianIds : [],
      createdById: input.createdById,
      acceptedPersonId: input.personId ?? null,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });
  return { token, url: appUrl(`/invite/${token}`), inviteId: invite.id };
}

export async function deliverInvite(token: string, channel: "email" | "sms"): Promise<{ sent: boolean; error?: string }> {
  const invite = await db.inviteToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite) return { sent: false, error: "Invite not found." };
  const url = appUrl(`/invite/${token}`);
  if (channel === "email") {
    if (!invite.email) return { sent: false, error: "No email on this invite." };
    const { html, text } = renderEmail({
      heading: `${invite.name}, you're invited to Fen's Closet`,
      body: "Tap the button to set your password and open your closet. The link works for 7 days.",
      cta: { label: "Set up my closet", url },
    });
    return sendEmail({ to: invite.email, subject: "Your Fen's Closet invite", html, text });
  }
  if (!invite.phone) return { sent: false, error: "No phone number on this invite." };
  return sendSms(invite.phone, `Fen's Closet: ${invite.name}, set up your closet here (link works 7 days): ${url}`);
}

export type OpenInvite = { id: string; name: string; email: string | null; phone: string | null; role: Role; expiresAt: Date; createdAt: Date; personId: string | null };

/** Invites nobody has accepted yet, newest first, so the People page can show, renew or cancel them (review A W6). */
export async function listOpenInvites(): Promise<OpenInvite[]> {
  const rows = await db.inviteToken.findMany({ where: { acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, role: r.role, expiresAt: r.expiresAt, createdAt: r.createdAt, personId: r.acceptedPersonId }));
}

/**
 * A fresh link for an open invite. Only the hash of a link is kept, so the old one cannot be shown again: it is retired
 * and a new one takes its place with the same name, role, parents and contact details.
 */
export async function renewInvite(inviteId: string, byAdminId: string): Promise<{ token: string; url: string; invite: OpenInvite }> {
  const old = await db.inviteToken.findUnique({ where: { id: inviteId } });
  if (!old || old.acceptedAt) throw new Error("That invite was already used.");
  const token = generateToken();
  const fresh = await db.$transaction(async (tx) => {
    await tx.inviteToken.update({ where: { id: old.id }, data: { expiresAt: new Date() } });
    return tx.inviteToken.create({
      data: {
        tokenHash: hashToken(token), name: old.name, email: old.email, phone: old.phone, role: old.role, guardianIds: old.guardianIds,
        createdById: byAdminId, acceptedPersonId: old.acceptedPersonId, expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
  });
  return { token, url: appUrl(`/invite/${token}`), invite: { id: fresh.id, name: fresh.name, email: fresh.email, phone: fresh.phone, role: fresh.role, expiresAt: fresh.expiresAt, createdAt: fresh.createdAt, personId: fresh.acceptedPersonId } };
}

/** Retires an open invite; the link stops working at once. */
export async function cancelInvite(inviteId: string): Promise<void> {
  await db.inviteToken.updateMany({ where: { id: inviteId, acceptedAt: null }, data: { expiresAt: new Date() } });
}

export async function peekInvite(token: string) {
  const invite = await db.inviteToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() <= Date.now()) return null;
  return { name: invite.name, email: invite.email, role: invite.role };
}

/** Accepts an invite: creates (or activates) the person with their personal closet and guardians. */
export async function acceptInvite(token: string, data: { name: string; password: string; email?: string }): Promise<{ ok: true; personId: string } | { ok: false; error: string }> {
  const invite = await db.inviteToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() <= Date.now()) return { ok: false, error: "This invite has expired or was already used." };
  const name = data.name.trim() || invite.name;
  const email = invite.email ?? (data.email ? normalizeEmail(data.email) : null);
  if (!email) return { ok: false, error: "Enter the email you'll sign in with." };

  const claimed = await db.inviteToken.updateMany({ where: { id: invite.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
  if (claimed.count !== 1) return { ok: false, error: "This invite was already used." };

  const passwordHash = await hashPassword(data.password);
  // Guardians are checked again here: an admin named on the invite may have been removed since (review A S7).
  const guardianIds = await activeAdminIds(invite.guardianIds);
  try {
    const personId = await db.$transaction(async (tx) => {
      let person;
      if (invite.acceptedPersonId) {
        person = await tx.person.update({
          where: { id: invite.acceptedPersonId },
          data: { name, email, phone: invite.phone ?? undefined, role: invite.role, passwordHash, status: "active", mustChangePassword: false },
        });
      } else {
        person = await tx.person.create({ data: { name, email, phone: invite.phone, role: invite.role, passwordHash, status: "active" } });
      }
      const closet = await tx.closet.findFirst({ where: { ownerId: person.id, kind: "personal" } });
      if (!closet) await tx.closet.create({ data: { name: `${person.name}'s closet`, kind: "personal", ownerId: person.id } });
      for (const parentId of guardianIds) {
        await tx.guardianLink.upsert({ where: { minorId_parentId: { minorId: person.id, parentId } }, update: {}, create: { minorId: person.id, parentId } });
      }
      await tx.inviteToken.update({ where: { id: invite.id }, data: { acceptedPersonId: person.id } });
      return person.id;
    });
    return { ok: true, personId };
  } catch (e) {
    await db.inviteToken.update({ where: { id: invite.id }, data: { acceptedAt: null } }).catch(() => {});
    if ((e as { code?: string }).code === "P2002") return { ok: false, error: "That email already belongs to someone in the family. Sign in instead, or ask an admin." };
    throw e;
  }
}

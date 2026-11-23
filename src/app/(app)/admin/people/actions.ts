"use server";

import { revalidatePath } from "next/cache";
import { currentAdmin } from "@/lib/auth/current";
import { cancelInvite, createInvite, deliverInvite, renewInvite } from "@/lib/auth/invite";
import { removePerson, setGuardians, setRole, updatePersonDetails } from "@/lib/people/service";
import { smsConfigured } from "@/lib/sms";
import type { Role } from "@/generated/prisma/client";

export type InviteResult = { ok: true; url: string; delivered: { email?: boolean; sms?: boolean }; deliveryError?: string } | { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };

const ADMINS_ONLY = "Admins only.";
function msg(e: unknown) { return e instanceof Error ? e.message : "Something went wrong."; }

/**
 * Sends an invite by the channels asked for. Each delivery is tried on its own and the link always comes back, so a
 * mail server that is down never loses an invite that was already made (review A §5).
 */
async function deliver(token: string, channels: Array<"email" | "sms">, contact: { email?: string | null; phone?: string | null }) {
  const delivered: { email?: boolean; sms?: boolean } = {};
  const errors: string[] = [];
  if (channels.includes("email") && contact.email) {
    try { const r = await deliverInvite(token, "email"); delivered.email = r.sent; if (!r.sent && r.error) errors.push(`Email: ${r.error}`); }
    catch (e) { console.error("[invite] email delivery threw", e); delivered.email = false; errors.push("Email: couldn't be sent just now. Copy the link instead."); }
  }
  if (channels.includes("sms") && contact.phone) {
    if (!smsConfigured()) errors.push("Text: texting isn't set up on the site yet. Copy the link instead.");
    else {
      try { const r = await deliverInvite(token, "sms"); delivered.sms = r.sent; if (!r.sent && r.error) errors.push(`Text: ${r.error}`); }
      catch (e) { console.error("[invite] sms delivery threw", e); delivered.sms = false; errors.push("Text: couldn't be sent just now. Copy the link instead."); }
    }
  }
  return { delivered, deliveryError: errors.length ? errors.join(" ") : undefined };
}

export async function invitePersonAction(input: {
  personId?: string; name: string; email?: string; phone?: string; role: Role; guardianIds?: string[]; channels: Array<"email" | "sms">;
}): Promise<InviteResult> {
  const admin = await currentAdmin();
  if (!admin) return { ok: false, error: ADMINS_ONLY };
  let token: string, url: string;
  try {
    ({ token, url } = await createInvite({
      name: input.name, email: input.email || null, phone: input.phone || null, role: input.role,
      guardianIds: input.guardianIds, createdById: admin.id, personId: input.personId,
    }));
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
  const outcome = await deliver(token, input.channels, { email: input.email, phone: input.phone });
  revalidatePath("/admin/people");
  if (input.personId) revalidatePath(`/admin/people/${input.personId}`);
  return { ok: true, url, ...outcome };
}

/** A fresh link for an open invite (the old one stops working), sent again by whatever channels the invite has (review A W6). */
export async function renewInviteAction(inviteId: string, send: boolean): Promise<InviteResult> {
  const admin = await currentAdmin();
  if (!admin) return { ok: false, error: ADMINS_ONLY };
  try {
    const { token, url, invite } = await renewInvite(inviteId, admin.id);
    const channels: Array<"email" | "sms"> = send ? [...(invite.email ? ["email" as const] : []), ...(invite.phone && smsConfigured() ? ["sms" as const] : [])] : [];
    const outcome = await deliver(token, channels, invite);
    revalidatePath("/admin/people");
    return { ok: true, url, ...outcome };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function cancelInviteAction(inviteId: string): Promise<SimpleResult> {
  if (!(await currentAdmin())) return { ok: false, error: ADMINS_ONLY };
  try { await cancelInvite(inviteId); revalidatePath("/admin/people"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function updatePersonAction(id: string, data: { name?: string; email?: string | null; phone?: string | null; birthdate?: string | null }): Promise<SimpleResult> {
  if (!(await currentAdmin())) return { ok: false, error: ADMINS_ONLY };
  try {
    await updatePersonDetails(id, { ...data, birthdate: data.birthdate === undefined ? undefined : data.birthdate ? new Date(data.birthdate) : null });
    revalidatePath("/admin/people"); revalidatePath(`/admin/people/${id}`);
    return { ok: true };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

/** Becoming a minor needs the parent admins named at the same time (review A S5). */
export async function setRoleAction(id: string, role: Role, guardianIds?: string[]): Promise<SimpleResult> {
  if (!(await currentAdmin())) return { ok: false, error: ADMINS_ONLY };
  try { await setRole(id, role, { guardianIds }); revalidatePath("/admin/people"); revalidatePath(`/admin/people/${id}`); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function setGuardiansAction(id: string, parentIds: string[]): Promise<SimpleResult> {
  if (!(await currentAdmin())) return { ok: false, error: ADMINS_ONLY };
  try { await setGuardians(id, parentIds); revalidatePath(`/admin/people/${id}`); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

/** Answers with a result, never a redirect: the client shows the toast and then moves on (review A W1). */
export async function removePersonAction(id: string, items: "delete" | "moveToFamily"): Promise<SimpleResult> {
  const admin = await currentAdmin();
  if (!admin) return { ok: false, error: ADMINS_ONLY };
  try { await removePerson(id, { items, byAdminId: admin.id }); }
  catch (e) { return { ok: false, error: msg(e) }; }
  revalidatePath("/admin/people");
  return { ok: true };
}

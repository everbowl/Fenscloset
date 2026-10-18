"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/current";
import { createInvite, deliverInvite } from "@/lib/auth/invite";
import { removePerson, setGuardians, setRole, updatePersonDetails } from "@/lib/people/service";
import { smsConfigured } from "@/lib/sms";
import type { Role } from "@/generated/prisma/client";

export type InviteResult = { ok: true; url: string; delivered: { email?: boolean; sms?: boolean }; deliveryError?: string } | { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };

function msg(e: unknown) { return e instanceof Error ? e.message : "Something went wrong."; }

export async function invitePersonAction(input: {
  personId?: string; name: string; email?: string; phone?: string; role: Role; guardianIds?: string[]; channels: Array<"email" | "sms">;
}): Promise<InviteResult> {
  const admin = await requireAdmin();
  try {
    const { token, url } = await createInvite({
      name: input.name, email: input.email || null, phone: input.phone || null, role: input.role,
      guardianIds: input.guardianIds, createdById: admin.id, personId: input.personId,
    });
    const delivered: { email?: boolean; sms?: boolean } = {};
    const errors: string[] = [];
    if (input.channels.includes("email") && input.email) {
      const r = await deliverInvite(token, "email"); delivered.email = r.sent; if (!r.sent && r.error) errors.push(`Email: ${r.error}`);
    }
    if (input.channels.includes("sms") && input.phone) {
      if (!smsConfigured()) errors.push("Text: SMS isn't connected yet (Twilio keys missing). Copy the link instead.");
      else { const r = await deliverInvite(token, "sms"); delivered.sms = r.sent; if (!r.sent && r.error) errors.push(`Text: ${r.error}`); }
    }
    revalidatePath("/admin/people");
    if (input.personId) revalidatePath(`/admin/people/${input.personId}`);
    return { ok: true, url, delivered, deliveryError: errors.length ? errors.join(" ") : undefined };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function updatePersonAction(id: string, data: { name?: string; email?: string | null; phone?: string | null; birthdate?: string | null }): Promise<SimpleResult> {
  await requireAdmin();
  try {
    await updatePersonDetails(id, { ...data, birthdate: data.birthdate === undefined ? undefined : data.birthdate ? new Date(data.birthdate) : null });
    revalidatePath("/admin/people"); revalidatePath(`/admin/people/${id}`);
    return { ok: true };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

export async function setRoleAction(id: string, role: Role): Promise<SimpleResult> {
  await requireAdmin();
  try { await setRole(id, role); revalidatePath("/admin/people"); revalidatePath(`/admin/people/${id}`); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function setGuardiansAction(id: string, parentIds: string[]): Promise<SimpleResult> {
  await requireAdmin();
  try { await setGuardians(id, parentIds); revalidatePath(`/admin/people/${id}`); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function removePersonAction(id: string, items: "delete" | "moveToFamily"): Promise<SimpleResult> {
  const admin = await requireAdmin();
  try { await removePerson(id, { items, byAdminId: admin.id }); }
  catch (e) { return { ok: false, error: msg(e) }; }
  revalidatePath("/admin/people");
  redirect("/admin/people");
}

export async function smsAvailableAction(): Promise<boolean> {
  await requireAdmin();
  return smsConfigured();
}

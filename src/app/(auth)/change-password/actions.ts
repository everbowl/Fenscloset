"use server";

import { redirect } from "next/navigation";
import { requirePerson, getCurrentSession } from "@/lib/auth/current";
import { setPassword, validateNewPassword } from "@/lib/auth/change-password";
import { db } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { hashToken } from "@/lib/auth/tokens";

export type ChangePasswordState = { error?: string };

export async function changePasswordAction(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const person = await requirePerson();
  const password = String(formData.get("password") ?? "");
  const problem = validateNewPassword(password);
  if (problem) return { error: problem };

  await setPassword(person.id, password);
  // Keep this session, drop every other one.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  await db.session.deleteMany({ where: { personId: person.id, NOT: token ? { tokenHash: hashToken(token) } : undefined } });
  const session = await getCurrentSession();
  if (session?.usedDevPassword) {
    await db.session.update({ where: { id: session.id }, data: { usedDevPassword: false } });
  }
  redirect("/today");
}

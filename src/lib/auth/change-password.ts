import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

const MIN_PASSWORD_LENGTH = 8;

export function validateNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}

/** Sets a new password and clears the must-change flag. Does not touch sessions; callers decide. */
export async function setPassword(personId: string, password: string): Promise<void> {
  await db.person.update({
    where: { id: personId },
    data: { passwordHash: await hashPassword(password), mustChangePassword: false, status: "active" },
  });
}

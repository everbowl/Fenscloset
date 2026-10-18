import { db } from "@/lib/db";
import { generateToken, hashToken } from "@/lib/auth/tokens";
import type { Person } from "@/generated/prisma/client";

export const SESSION_COOKIE = "fc_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_WHEN_LEFT_MS = 15 * 24 * 60 * 60 * 1000; // refresh when < 15 days remain

export type SessionWithPerson = {
  id: string;
  personId: string;
  expiresAt: Date;
  usedDevPassword: boolean;
  person: Person;
};

export async function createSession(
  personId: string,
  meta: { userAgent?: string; usedDevPassword?: boolean } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: {
      personId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 255),
      usedDevPassword: meta.usedDevPassword ?? false,
    },
  });
  return { token, expiresAt };
}

export async function validateSession(token: string): Promise<SessionWithPerson | null> {
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { person: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.person.status === "removed") return null;
  const timeLeft = session.expiresAt.getTime() - Date.now();
  if (timeLeft < REFRESH_WHEN_LEFT_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.session.update({ where: { id: session.id }, data: { expiresAt, lastSeenAt: new Date() } });
    session.expiresAt = expiresAt;
  }
  return session;
}

export async function destroySession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function destroyAllSessionsFor(personId: string): Promise<void> {
  await db.session.deleteMany({ where: { personId } });
}

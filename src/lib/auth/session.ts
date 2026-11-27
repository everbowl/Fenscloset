import { db } from "@/lib/db";
import { generateToken, hashToken } from "@/lib/auth/tokens";
import { SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/cookies";
import type { Person } from "@/generated/prisma/client";

export { SESSION_COOKIE, SESSION_TTL_MS };
const REFRESH_WHEN_LEFT_MS = 15 * 24 * 60 * 60 * 1000; // refresh when < 15 days remain

export type SessionWithPerson = {
  id: string;
  personId: string;
  expiresAt: Date;
  person: Person;
};

export async function createSession(
  personId: string,
  meta: { userAgent?: string } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: {
      personId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 255),
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
  // The sliding refresh is one write every fifteen days at most: once it runs, thirty days remain and nothing else writes
  // until fewer than fifteen do. The cookie's own expiry is pushed along by the proxy on each page load (review A W3).
  if (session.expiresAt.getTime() - Date.now() < REFRESH_WHEN_LEFT_MS) {
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

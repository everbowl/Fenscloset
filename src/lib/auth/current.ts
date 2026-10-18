import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, createSession, destroySession, validateSession, type SessionWithPerson } from "@/lib/auth/session";
import type { Person } from "@/generated/prisma/client";

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** The current session, memoised per request. */
export const getCurrentSession = cache(async (): Promise<SessionWithPerson | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(token);
});

export async function getCurrentPerson(): Promise<Person | null> {
  const session = await getCurrentSession();
  return session?.person ?? null;
}

/** Redirects to /login when signed out. */
export async function requirePerson(): Promise<Person> {
  const person = await getCurrentPerson();
  if (!person) redirect("/login");
  return person;
}

export function isAdmin(person: Pick<Person, "role">): boolean {
  return person.role === "admin";
}

/** Throws ForbiddenError for non-admins; pages catch it and render the 403 page. */
export async function requireAdmin(): Promise<Person> {
  const person = await requirePerson();
  if (!isAdmin(person)) throw new ForbiddenError();
  return person;
}

export async function signIn(personId: string, opts: { usedDevPassword?: boolean } = {}) {
  const ua = (await headers()).get("user-agent") ?? undefined;
  const { token, expiresAt } = await createSession(personId, { userAgent: ua, usedDevPassword: opts.usedDevPassword });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function signOut() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  store.delete(SESSION_COOKIE);
}

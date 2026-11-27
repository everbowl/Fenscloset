import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { SESSION_COOKIE, createSession, destroySession, validateSession, type SessionWithPerson } from "@/lib/auth/session";
import type { Person } from "@/generated/prisma/client";
import { cookieSecure } from "@/lib/app-url";

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

/**
 * The signed-in admin. For anyone else the page segment stops here with a 404, before any admin data loads (review A
 * S3); the admin layout already shows "Admins only" in its place, so that is what the person sees (S4).
 */
export async function requireAdmin(): Promise<Person> {
  const person = await requirePerson();
  if (!isAdmin(person)) notFound();
  return person;
}

/** For server actions: the signed-in admin, or null, so the action can answer with words instead of an error page. */
export async function currentAdmin(): Promise<Person | null> {
  const person = await requirePerson();
  return isAdmin(person) ? person : null;
}

export async function signIn(personId: string) {
  const ua = (await headers()).get("user-agent") ?? undefined;
  const { token, expiresAt } = await createSession(personId, { userAgent: ua });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
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

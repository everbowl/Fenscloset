"use server";

import { cookies } from "next/headers";
import { requirePerson } from "@/lib/auth/current";
import { VIEW_COOKIE } from "@/lib/people/visibility";

/** Remembers which closet the person is browsing (their own, someone else's, or Family). */
export async function setViewAction(key: string): Promise<void> {
  await requirePerson();
  const store = await cookies();
  store.set(VIEW_COOKIE, key.slice(0, 64), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

import { NextResponse } from "next/server";
import { getCurrentPerson } from "@/lib/auth/current";
import { connectUrl, isGoogleConfigured } from "@/lib/plans/google";

/** Sends the signed-in person to Google's consent screen (read-only calendar). */
export async function GET(req: Request) {
  const person = await getCurrentPerson();
  if (!person) return NextResponse.redirect(new URL("/login", req.url));
  if (!isGoogleConfigured()) return NextResponse.redirect(new URL("/profile/settings?calendar=unconfigured", req.url));
  return NextResponse.redirect(connectUrl(person.id));
}

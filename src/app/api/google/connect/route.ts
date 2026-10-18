import { NextResponse } from "next/server";
import { getCurrentPerson } from "@/lib/auth/current";
import { connectUrl, isGoogleConfigured } from "@/lib/plans/google";
import { appUrl } from "@/lib/app-url";

/** Sends the signed-in person to Google's consent screen (read-only calendar). */
export async function GET() {
  const person = await getCurrentPerson();
  if (!person) return NextResponse.redirect(appUrl("/login"));
  if (!isGoogleConfigured()) return NextResponse.redirect(appUrl("/profile/settings?calendar=unconfigured"));
  return NextResponse.redirect(connectUrl(person.id));
}

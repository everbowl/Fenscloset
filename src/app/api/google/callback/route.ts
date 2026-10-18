import { NextResponse } from "next/server";
import { getCurrentPerson } from "@/lib/auth/current";
import { finishConnect, personFromState } from "@/lib/plans/google";

/** Google sends the code back here; the state must belong to the signed-in person. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const person = await getCurrentPerson();
  if (!person) return NextResponse.redirect(new URL("/login", req.url));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const back = (q: string) => NextResponse.redirect(new URL(`/profile/settings?calendar=${q}`, req.url));
  if (url.searchParams.get("error") || !code) return back("denied");
  if (personFromState(state) !== person.id) return back("mismatch");
  try {
    await finishConnect(person.id, code);
    return back("connected");
  } catch (e) {
    console.error("google connect", e);
    return back("failed");
  }
}

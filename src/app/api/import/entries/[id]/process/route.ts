import { NextResponse } from "next/server";
import { getCurrentPerson } from "@/lib/auth/current";
import { ImportError, retryEntry } from "@/lib/import/service";

/** POST → re-queues a failed (or stuck) entry. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const person = await getCurrentPerson();
  if (!person) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  try {
    await retryEntry(person.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ImportError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

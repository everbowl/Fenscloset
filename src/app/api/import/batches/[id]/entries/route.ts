import { NextResponse } from "next/server";
import { getCurrentPerson } from "@/lib/auth/current";
import { ImportError, registerEntry } from "@/lib/import/service";

/** POST { key, order } → { entryId }. The photo must already be in the bucket. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const person = await getCurrentPerson();
  if (!person) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  let body: { key?: string; order?: number } = {};
  try { body = await req.json(); } catch { /* empty */ }
  try {
    const entry = await registerEntry(person.id, id, String(body.key ?? ""), Number(body.order) || 0);
    return NextResponse.json({ entryId: entry.id });
  } catch (e) {
    if (e instanceof ImportError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

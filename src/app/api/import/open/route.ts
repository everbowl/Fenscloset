import { NextResponse } from "next/server";
import { getCurrentPerson } from "@/lib/auth/current";
import { openBatch } from "@/lib/import/service";

export const dynamic = "force-dynamic";

/** GET → { batch: BatchSummary | null }. Polled by the Add screen while work is in flight. */
export async function GET() {
  const person = await getCurrentPerson();
  if (!person) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  return NextResponse.json({ batch: await openBatch(person.id) }, { headers: { "Cache-Control": "no-store" } });
}

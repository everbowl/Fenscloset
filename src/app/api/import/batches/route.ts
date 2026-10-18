import { NextResponse } from "next/server";
import { getCurrentPerson } from "@/lib/auth/current";
import { getOrCreateOpenBatch } from "@/lib/import/service";

/** POST { total } → { batchId, startOrder, total }. Adds to the open batch if there is one. */
export async function POST(req: Request) {
  const person = await getCurrentPerson();
  if (!person) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let total = 0;
  try { total = Number((await req.json()).total) || 0; } catch { /* empty */ }
  if (total < 0 || total > 2000) return NextResponse.json({ error: "Pick between 1 and 2000 photos." }, { status: 400 });
  const b = await getOrCreateOpenBatch(person.id, total);
  return NextResponse.json({ batchId: b.id, startOrder: b.startOrder, total: b.total });
}

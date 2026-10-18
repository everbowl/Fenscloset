import { NextResponse } from "next/server";
import { getCurrentPerson } from "@/lib/auth/current";
import { IMAGE_TYPES, PHOTO_KINDS, signUpload, type PhotoKeyKind } from "@/lib/storage";

/** POST { contentType, kind? } → { key, url, method, headers }. The key is scoped to the signed-in person. */
export async function POST(req: Request) {
  const person = await getCurrentPerson();
  if (!person) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { contentType?: string; kind?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const contentType = body.contentType ?? "";
  if (!IMAGE_TYPES[contentType]) return NextResponse.json({ error: "Use a JPEG, PNG or WebP photo." }, { status: 400 });
  const kind = (body.kind ?? "originals") as PhotoKeyKind;
  if (!PHOTO_KINDS.includes(kind) || kind === "cutouts" || kind === "thumbs") return NextResponse.json({ error: "Bad kind." }, { status: 400 });
  const signed = await signUpload({ ownerId: person.id, kind, contentType });
  return NextResponse.json(signed);
}

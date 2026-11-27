import { NextResponse } from "next/server";
import { getCurrentPerson } from "@/lib/auth/current";
import { IMAGE_TYPES, signUpload, type PhotoKeyKind } from "@/lib/storage";
import { db } from "@/lib/db";

/** The kinds a phone may upload into. Cutouts, thumbs, try-on, mannequin and look pictures are made by the server only (review B B22). */
const UPLOAD_KINDS: PhotoKeyKind[] = ["originals", "labels", "worn", "avatars", "bodies", "checkins", "fits", "shop", "inspo"];

/** POST { contentType, kind?, ownerId? } → { key, url, method, headers }. The key is scoped to the signed-in person, or to a minor they parent. */
export async function POST(req: Request) {
  const person = await getCurrentPerson();
  if (!person) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { contentType?: string; kind?: string; ownerId?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const contentType = body.contentType ?? "";
  if (!IMAGE_TYPES[contentType]) return NextResponse.json({ error: "Use a JPEG, PNG or WebP photo." }, { status: 400 });
  const kind = (body.kind ?? "originals") as PhotoKeyKind;
  if (!UPLOAD_KINDS.includes(kind)) return NextResponse.json({ error: "Bad kind." }, { status: 400 });
  let ownerId = person.id;
  if (body.ownerId && body.ownerId !== person.id) {
    const link = await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: body.ownerId, parentId: person.id } } });
    if (!link) return NextResponse.json({ error: "You can only upload for yourself or a minor you parent." }, { status: 403 });
    ownerId = body.ownerId;
  }
  const signed = await signUpload({ ownerId, kind, contentType });
  return NextResponse.json(signed);
}

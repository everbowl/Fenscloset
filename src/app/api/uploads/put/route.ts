import { NextResponse } from "next/server";
import { getCurrentPerson } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { MAX_UPLOAD_BYTES, parseKey, putObject, verifyUploadToken } from "@/lib/storage";

/** Relay for signed uploads: PUT body → bucket. Same-origin, session + signed token, owner-only key. */
export async function PUT(req: Request) {
  const person = await getCurrentPerson();
  if (!person) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  const parsed = parseKey(key);
  // The cheap checks first (review B B23): a bad or stale token is refused before any lookup.
  if (!parsed || !verifyUploadToken(key, contentType, exp, sig)) return NextResponse.json({ error: "That upload link is not valid any more." }, { status: 403 });
  const ownsKey = parsed.ownerId === person.id || Boolean(await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: parsed.ownerId, parentId: person.id } } }));
  if (!ownsKey) return NextResponse.json({ error: "That upload link is not valid any more." }, { status: 403 });
  // Too big is refused on the declared size before a byte is read (review B B21), and again on the bytes themselves.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "That photo is too big." }, { status: 413 });
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) return NextResponse.json({ error: "Empty file." }, { status: 400 });
  if (bytes.length > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "That photo is too big." }, { status: 413 });
  await putObject(key, bytes, contentType);
  return NextResponse.json({ key });
}

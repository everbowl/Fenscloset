import { getCurrentPerson } from "@/lib/auth/current";
import { canViewKey } from "@/lib/photos/visibility";
import { getObjectStream, NotFoundError } from "@/lib/storage";

/**
 * The only way a browser sees a photo. 404 for anything the viewer may not see (no existence leak).
 *
 * Keys are content-addressed: every rotate, re-cut, refit or new photo writes a new key (src/lib/storage.ts newKey), so a
 * key's bytes never change and the phone may keep them for a year (review B A1: the one-hour cache made every closet
 * thumbnail a 150–700 ms round trip through Node after an hour). The ETag is the key; a revalidation answers 304 without
 * touching the bucket. The body streams straight from the bucket; nothing is buffered here.
 */
const CACHE = "private, max-age=31536000, immutable";

export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const person = await getCurrentPerson();
  if (!person) return new Response("Not found", { status: 404 });
  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  if (!(await canViewKey(person, key))) return new Response("Not found", { status: 404 });
  const etag = `"${key.replace(/[^A-Za-z0-9._/-]/g, "")}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": CACHE } });
  try {
    const { stream, contentType, length } = await getObjectStream(key);
    return new Response(stream, {
      headers: {
        "Content-Type": contentType,
        ...(length !== null ? { "Content-Length": String(length) } : {}),
        "Cache-Control": CACHE,
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}

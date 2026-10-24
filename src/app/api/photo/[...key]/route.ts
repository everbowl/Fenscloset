import { getCurrentPerson } from "@/lib/auth/current";
import { canViewKey } from "@/lib/photos/visibility";
import { getObject, NotFoundError } from "@/lib/storage";

/** The only way a browser sees a photo. 404 for anything the viewer may not see (no existence leak). */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const person = await getCurrentPerson();
  if (!person) return new Response("Not found", { status: 404 });
  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  if (!(await canViewKey(person, key))) return new Response("Not found", { status: 404 });
  try {
    const { body, contentType } = await getObject(key);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(body.length),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { deleteLookup, lookup, ShopError } from "@/lib/shop/engine";
import { IMAGE_TYPES } from "@/lib/storage";

export type Result = { ok: true; id?: string } | { ok: false; error: string };

async function run(fn: () => Promise<string | void>): Promise<Result> {
  try { const id = await fn(); revalidatePath("/shop"); return { ok: true, id: id ?? undefined }; }
  catch (e) { if (e instanceof ShopError) return { ok: false, error: e.message }; console.error(e); return { ok: false, error: "Something went wrong. Try again." }; }
}

export async function lookupLinkAction(forPersonId: string, url: string): Promise<Result> {
  const me = await requirePerson();
  return run(async () => (await lookup(me, forPersonId, { source: "link", url })).id);
}

/** form: `photo` (file) + `source` ("screenshot" | "photo") */
export async function lookupPhotoAction(forPersonId: string, form: FormData): Promise<Result> {
  const me = await requirePerson();
  return run(async () => {
    const file = form.get("photo");
    const source = form.get("source") === "photo" ? "photo" : "screenshot";
    if (!(file instanceof File) || !IMAGE_TYPES[file.type]) throw new ShopError("Use a JPEG, PNG or WebP image.");
    if (file.size > 12 * 1024 * 1024) throw new ShopError("That image is too large.");
    return (await lookup(me, forPersonId, { source, data: Buffer.from(await file.arrayBuffer()), contentType: file.type as "image/jpeg" })).id;
  });
}

export async function deleteLookupAction(id: string): Promise<Result> {
  const me = await requirePerson();
  return run(() => deleteLookup(me, id));
}

"use server";

import { revalidatePath } from "next/cache";
import { requirePerson } from "@/lib/auth/current";
import { deleteLookup, lookup, ShopError } from "@/lib/shop/engine";
import { getObject, IMAGE_TYPES } from "@/lib/storage";
import { getLookup } from "@/lib/shop/engine";
import { tryOnLook, tryOnState, TryOnError, type TryOnView } from "@/lib/tryon";
import { isMannequinConfigured, mannequinLook } from "@/lib/tryon/mannequin";

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

/** SEE IT ON: the candidate piece (its store photo) on the person's own body photo when their try-on is ready, else on the shared mannequin (V A), with the first pairing's other pieces. */
export async function tryOnLookupAction(lookupId: string): Promise<Result & { tryOn?: TryOnView }> {
  const me = await requirePerson();
  try {
    const v = await getLookup(me, lookupId);
    if (!v) return { ok: false, error: "That lookup is gone." };
    if (!v.imageKey) return { ok: false, error: "No picture of the piece to try on." };
    const others = v.pairings[0]?.itemIds.filter((id) => id !== "candidate") ?? [];
    const garment = (await getObject(v.imageKey)).body;
    const own = (await tryOnState(me, v.forPersonId)) === "ready";
    const tryOn = own ? await tryOnLook(me, v.forPersonId, others.slice(0, 2), `shop:${lookupId}`, garment)
      : isMannequinConfigured() ? await mannequinLook(me, v.forPersonId, others.slice(0, 2), `shop:${lookupId}`, garment)
      : await tryOnLook(me, v.forPersonId, others.slice(0, 2), `shop:${lookupId}`, garment); // throws with the reason
    return { ok: true, tryOn };
  } catch (e) {
    if (e instanceof TryOnError || e instanceof ShopError) return { ok: false, error: e.message };
    console.error(e); return { ok: false, error: "The try-on didn’t come back. Try again." };
  }
}

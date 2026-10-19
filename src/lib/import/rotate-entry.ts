import { db } from "@/lib/db";
import { deleteObject, getObject, newKey, putObject } from "@/lib/storage";
import { quarterTurn, rotateImage, type RotateDirection } from "@/lib/images/rotate";
import { makeThumb } from "@/lib/images/thumb";
import { phash } from "@/lib/images/phash";
import { ItemError } from "@/lib/items/service";

/**
 * ROTATE on the confirm card: a quarter turn of the entry's photo (the cutout when there is one, and the
 * parked smoothed copy too), with a fresh thumbnail and hash. The original upload is left as it was.
 */
export async function rotateEntry(personId: string, entryId: string, dir: RotateDirection): Promise<{ photoKey: string; smoothKey: string | null }> {
  const entry = await db.importEntry.findUnique({ where: { id: entryId }, include: { batch: true } });
  if (!entry || entry.batch.personId !== personId) throw new ItemError("Not yours.", 403);
  const deg = quarterTurn(dir);
  const turn = async (key: string) => {
    const type = key.endsWith(".png") ? "image/png" : "image/jpeg";
    const out = await rotateImage((await getObject(key)).body, deg, type);
    const next = newKey("cutouts", personId, type);
    await putObject(next, out, type);
    return { next, out };
  };
  const photo = await turn(entry.cutoutKey ?? entry.originalKey);
  const smooth = entry.smoothKey ? await turn(entry.smoothKey) : null;
  const thumb = await makeThumb(photo.out);
  const thumbKey = newKey("thumbs", personId, "image/jpeg");
  await putObject(thumbKey, thumb, "image/jpeg");
  await db.importEntry.update({ where: { id: entryId }, data: { cutoutKey: photo.next, thumbKey, smoothKey: smooth?.next ?? null, phash: await phash(photo.out) } });
  for (const old of [entry.cutoutKey, entry.thumbKey, entry.smoothKey]) if (old) await deleteObject(old).catch(() => undefined);
  return { photoKey: photo.next, smoothKey: smooth?.next ?? null };
}

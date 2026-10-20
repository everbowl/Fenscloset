import { db } from "@/lib/db";
import { deleteObject, getObject, newKey, putObject } from "@/lib/storage";
import { quarterTurn, rotateImage, type RotateDirection } from "@/lib/images/rotate";
import { makeThumb } from "@/lib/images/thumb";
import { phash } from "@/lib/images/phash";
import { ItemError } from "@/lib/items/service";

/**
 * ROTATE on the confirm card: a quarter turn of the entry's photo (the cutout when there is one), with a
 * fresh thumbnail and hash. The original upload is left as it was.
 */
export async function rotateEntry(personId: string, entryId: string, dir: RotateDirection): Promise<{ photoKey: string }> {
  const entry = await db.importEntry.findUnique({ where: { id: entryId }, include: { batch: true } });
  if (!entry || entry.batch.personId !== personId) throw new ItemError("Not yours.", 403);
  const deg = quarterTurn(dir);
  const key = entry.cutoutKey ?? entry.originalKey;
  const type = key.endsWith(".png") ? "image/png" : "image/jpeg";
  const out = await rotateImage((await getObject(key)).body, deg, type);
  const next = newKey("cutouts", personId, type);
  await putObject(next, out, type);
  const thumb = await makeThumb(out);
  const thumbKey = newKey("thumbs", personId, "image/jpeg");
  await putObject(thumbKey, thumb, "image/jpeg");
  await db.importEntry.update({ where: { id: entryId }, data: { cutoutKey: next, thumbKey, phash: await phash(out) } });
  for (const old of [entry.cutoutKey, entry.thumbKey]) if (old) await deleteObject(old).catch(() => undefined);
  return { photoKey: next };
}

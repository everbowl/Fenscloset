import { db } from "@/lib/db";
import { deleteObject, getObject, newKey, putObject } from "@/lib/storage";
import { rotateImage, quarterTurn, type RotateDirection } from "@/lib/images/rotate";
import { makeThumb } from "@/lib/images/thumb";
import { phash } from "@/lib/images/phash";
import { ItemError } from "@/lib/items/service";

/**
 * ROTATE on the confirm card: a quarter turn of the entry's photo (the cutout when there is one), with a
 * fresh thumbnail and hash. The original upload is left as it was. The three writes after the turn (cutout, thumb,
 * hash) run side by side (review B B14): "Turning…" was four bucket round trips in a row.
 */
export async function rotateEntry(personId: string, entryId: string, dir: RotateDirection): Promise<{ photoKey: string }> {
  const entry = await db.importEntry.findUnique({ where: { id: entryId }, include: { batch: true } });
  if (!entry || entry.batch.personId !== personId) throw new ItemError("Not yours.", 403);
  const deg = quarterTurn(dir);
  const key = entry.cutoutKey ?? entry.originalKey;
  const type = key.endsWith(".png") ? "image/png" : "image/jpeg";
  const out = await rotateImage((await getObject(key)).body, deg, type);
  const next = newKey("cutouts", personId, type);
  const thumbKey = newKey("thumbs", personId, "image/jpeg");
  const [, , hash] = await Promise.all([
    putObject(next, out, type),
    makeThumb(out).then((thumb) => putObject(thumbKey, thumb, "image/jpeg")),
    phash(out),
  ]);
  await db.importEntry.update({ where: { id: entryId }, data: { cutoutKey: next, thumbKey, phash: hash } });
  await Promise.all([entry.cutoutKey, entry.thumbKey].filter((k): k is string => Boolean(k)).map((old) => deleteObject(old).catch(() => undefined)));
  return { photoKey: next };
}

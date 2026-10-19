import { db } from "@/lib/db";
import { deleteObject, getObject, newKey, putObject } from "@/lib/storage";
import { smoothGarment, type SmoothStrength } from "@/lib/images/smooth";
import { fitCutout, makeThumb } from "@/lib/images/thumb";
import { ItemError } from "@/lib/items/service";

/**
 * SMOOTH on the confirm card: makes a wrinkle-free copy of the entry's photo (the cutout when there is
 * one) and parks it as `smoothKey` until the person taps KEEP or UNDO. Nothing changes on the piece
 * until KEEP.
 */

async function owned(personId: string, entryId: string) {
  const entry = await db.importEntry.findUnique({ where: { id: entryId }, include: { batch: true } });
  if (!entry || entry.batch.personId !== personId) throw new ItemError("Not yours.", 403);
  return entry;
}

export async function smoothEntry(personId: string, entryId: string, strength: SmoothStrength = "normal"): Promise<{ smoothKey: string }> {
  const entry = await owned(personId, entryId);
  if (entry.smoothKey && strength === "normal") return { smoothKey: entry.smoothKey };
  if (entry.smoothKey) { await deleteObject(entry.smoothKey).catch(() => undefined); } // "Smooth more" / "Tidy" replace the parked copy
  const source = entry.cutoutKey ?? entry.originalKey;
  const { body } = await getObject(source);
  const out = await smoothGarment(body, fetch, strength);
  const data = out.contentType === "image/png" ? await fitCutout(out.data) : out.data;
  const smoothKey = newKey("cutouts", personId, out.contentType);
  await putObject(smoothKey, data, out.contentType);
  await db.importEntry.update({ where: { id: entryId }, data: { smoothKey } });
  return { smoothKey };
}

/** KEEP makes the smoothed copy the photo of record (and remakes the thumbnail); UNDO throws it away. */
export async function keepSmooth(personId: string, entryId: string, keep: boolean): Promise<{ photoKey: string }> {
  const entry = await owned(personId, entryId);
  if (!entry.smoothKey) return { photoKey: entry.cutoutKey ?? entry.originalKey };
  if (!keep) {
    await deleteObject(entry.smoothKey).catch(() => undefined);
    await db.importEntry.update({ where: { id: entryId }, data: { smoothKey: null } });
    return { photoKey: entry.cutoutKey ?? entry.originalKey };
  }
  const thumb = await makeThumb((await getObject(entry.smoothKey)).body);
  const thumbKey = newKey("thumbs", personId, "image/jpeg");
  await putObject(thumbKey, thumb, "image/jpeg");
  await db.importEntry.update({ where: { id: entryId }, data: { cutoutKey: entry.smoothKey, thumbKey, smoothKey: null } });
  if (entry.cutoutKey) await deleteObject(entry.cutoutKey).catch(() => undefined);
  if (entry.thumbKey) await deleteObject(entry.thumbKey).catch(() => undefined);
  return { photoKey: entry.smoothKey };
}

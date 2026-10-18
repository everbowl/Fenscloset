import sharp from "sharp";
import { db } from "@/lib/db";
import { deleteObject, getObject, newKey, putObject } from "@/lib/storage";
import { fitCutout, makeThumb } from "@/lib/images/thumb";

/**
 * One-time tidy for pieces added before cutouts were trimmed (18 Oct 2026): every cutout loses its
 * empty margin and its thumbnail is remade, so the piece fills the box like a new one. Safe to run
 * again: a cutout with no margin is left alone. New keys are written so nothing cached stays stale.
 */
export async function refitCutouts(): Promise<{ checked: number; refit: number }> {
  const cutouts = await db.itemPhoto.findMany({ where: { kind: "cutout" }, select: { id: true, itemId: true, bucketKey: true, item: { select: { ownerId: true } } } });
  let refit = 0;
  for (const c of cutouts) {
    let body: Buffer;
    try { body = (await getObject(c.bucketKey)).body; } catch { continue; }
    const fitted = await fitCutout(body);
    const before = await sharp(body).metadata();
    const after = await sharp(fitted).metadata();
    if (before.width === after.width && before.height === after.height) continue;
    const ownerId = c.item.ownerId;
    const cutKey = newKey("cutouts", ownerId, "image/png");
    await putObject(cutKey, fitted, "image/png");
    const thumbKey = newKey("thumbs", ownerId, "image/jpeg");
    await putObject(thumbKey, await makeThumb(fitted), "image/jpeg");
    const oldThumb = await db.itemPhoto.findFirst({ where: { itemId: c.itemId, kind: "thumb" } });
    await db.$transaction(async (tx) => {
      await tx.itemPhoto.update({ where: { id: c.id }, data: { bucketKey: cutKey, width: after.width ?? null, height: after.height ?? null } });
      if (oldThumb) await tx.itemPhoto.update({ where: { id: oldThumb.id }, data: { bucketKey: thumbKey } });
      else await tx.itemPhoto.create({ data: { itemId: c.itemId, kind: "thumb", bucketKey: thumbKey } });
    });
    await deleteObject(c.bucketKey).catch(() => undefined);
    if (oldThumb) await deleteObject(oldThumb.bucketKey).catch(() => undefined);
    refit++;
  }
  return { checked: cutouts.length, refit };
}

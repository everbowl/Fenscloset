import sharp from "sharp";
import { db } from "@/lib/db";
import { deleteObject, getObject, newKey, NotFoundError, putObject } from "@/lib/storage";
import { removeBackground, RemoveBgError } from "@/lib/images/remove-bg";
import { fitCutout, imageSize, makeThumb, normalizeOriginal } from "@/lib/images/thumb";
import { rotateImage } from "@/lib/images/rotate";
import type { EntryAiResult } from "@/lib/import/process";

/**
 * Undoes Tidy and Smooth (Jeff, 19 Oct 2026: "REMOVE TIDY FOR NOW. DOESN'T WORK AND DON'T WANT IT"). Both put an
 * AI edit in place of a piece's cutout when the person kept it, and the plain cutout was deleted, so the database
 * cannot tell which pieces were touched. Every piece added since Smooth went live (18 Oct 2026, 12:57 PM PT) gets
 * a fresh cutout from its original upload, one remove.bg call each; a piece that was never touched gets the same
 * cutout back. The old cutout is used for one thing, its orientation, so a piece the person turned on the card
 * stays turned.
 *
 * Runs once, in the background, when the server starts (src/instrumentation.ts). Each entry is marked as it goes
 * ("recut" in the entry's warnings), so a restart carries on where it stopped and never pays for a piece twice.
 * UNTIDY_SET is recorded once every piece is done; a remove.bg failure leaves that piece for the next start.
 */
export const UNTIDY_SET = "untidy-v1";
export const UNTIDY_SINCE = new Date("2026-10-18T19:57:29Z");

export type UntidyReport = { recut: number; skipped: number; failed: number; done: boolean; /** Why the last piece was left (remove.bg's word for it). */ lastError?: string };
/** While pieces are left (remove.bg out of credits, say), the server tries again this often; Admin → Rules has a button for right now. */
export const UNTIDY_RETRY_MS = 60 * 60_000;

type Quarter = 0 | 90 | 180 | 270;

export async function untidyAll(opts: { log?: (line: string) => void } = {}): Promise<UntidyReport> {
  const log = opts.log ?? (() => undefined);
  const report: UntidyReport = { recut: 0, skipped: 0, failed: 0, done: false };
  if (await db.seedSet.findUnique({ where: { name: UNTIDY_SET } })) return { ...report, done: true };
  const entries = await db.importEntry.findMany({
    where: { status: "done", itemId: { not: null }, cutoutKey: { not: null }, createdAt: { gte: UNTIDY_SINCE } },
    orderBy: { createdAt: "asc" },
    include: { batch: { select: { personId: true } } },
  });
  for (const entry of entries) {
    const ai = (entry.aiResult as Partial<EntryAiResult> | null) ?? {};
    const warnings = ai.warnings ?? [];
    if (warnings.some((w) => w.startsWith("recut"))) continue;
    const mark = (w: string) => db.importEntry.update({ where: { id: entry.id }, data: { aiResult: JSON.parse(JSON.stringify({ ...ai, warnings: [...warnings, w] })) } });
    const photo = (await db.itemPhoto.findFirst({ where: { bucketKey: entry.cutoutKey!, kind: "cutout" } })) ?? (await onlyPhoto(entry.itemId!, "cutout"));
    if (!photo) { await mark("recut:none"); report.skipped++; continue; }
    let original: Buffer;
    try { original = (await getObject(entry.originalKey)).body; } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
      await mark("recut:no_original"); report.skipped++; continue;
    }
    let cut: Buffer;
    try { cut = await removeBackground(await normalizeOriginal(original)); } catch (e) {
      if (!(e instanceof RemoveBgError)) throw e;
      report.lastError = `remove.bg ${e.code}: ${e.message}`;
      log(`untidy: ${entry.id} left for later, ${report.lastError}`); report.failed++; continue;
    }
    let fitted = await fitCutout(cut);
    let old: Buffer | null = null;
    try { old = (await getObject(photo.bucketKey)).body; } catch { old = null; }
    const turn = old ? await bestTurn(old, fitted) : 0;
    if (turn) fitted = await rotateImage(fitted, turn, "image/png");
    const size = await imageSize(fitted);
    const ownerId = entry.batch.personId;
    const cutKey = newKey("cutouts", ownerId, "image/png");
    await putObject(cutKey, fitted, "image/png");
    const thumbKey = newKey("thumbs", ownerId, "image/jpeg");
    await putObject(thumbKey, await makeThumb(fitted), "image/jpeg");
    const thumb = (entry.thumbKey ? await db.itemPhoto.findFirst({ where: { bucketKey: entry.thumbKey, kind: "thumb" } }) : null) ?? (await onlyPhoto(photo.itemId, "thumb"));
    await db.$transaction(async (tx) => {
      await tx.itemPhoto.update({ where: { id: photo.id }, data: { bucketKey: cutKey, width: size.width, height: size.height, wholeGarment: null } });
      if (thumb) await tx.itemPhoto.update({ where: { id: thumb.id }, data: { bucketKey: thumbKey } });
      else await tx.itemPhoto.create({ data: { itemId: photo.itemId, kind: "thumb", bucketKey: thumbKey } });
      await tx.importEntry.update({ where: { id: entry.id }, data: { cutoutKey: cutKey, thumbKey, aiResult: JSON.parse(JSON.stringify({ ...ai, warnings: [...warnings, "recut"] })) } });
    });
    await deleteObject(photo.bucketKey).catch(() => undefined);
    if (thumb) await deleteObject(thumb.bucketKey).catch(() => undefined);
    report.recut++;
    log(`untidy: ${entry.id} re-cut from the original${turn ? `, turned ${turn}°` : ""}`);
  }
  if (report.failed === 0) { await db.seedSet.create({ data: { name: UNTIDY_SET } }); report.done = true; }
  return report;
}

/** How many pieces still wait for their fresh cutout (0 once the set is recorded). Admin → Rules shows it while it is above 0. */
export async function untidyPending(): Promise<number> {
  if (await db.seedSet.findUnique({ where: { name: UNTIDY_SET } })) return 0;
  const entries = await db.importEntry.findMany({ where: { status: "done", itemId: { not: null }, cutoutKey: { not: null }, createdAt: { gte: UNTIDY_SINCE } }, select: { aiResult: true } });
  return entries.filter((e) => !((e.aiResult as Partial<EntryAiResult> | null)?.warnings ?? []).some((w) => w.startsWith("recut"))).length;
}

/** The item's one photo of that kind, when there is exactly one (an entry's keys can be stale after a refit). */
async function onlyPhoto(itemId: string, kind: "cutout" | "thumb") {
  const photos = await db.itemPhoto.findMany({ where: { itemId, kind }, take: 2 });
  return photos.length === 1 ? photos[0] : null;
}

/**
 * Which quarter turn of `fresh` lines up with `old`: the silhouettes (alpha) are compared at 32×32, or the light
 * across the picture when the old one has no transparency. A piece the person turned on the confirm card comes
 * back turned the same way.
 */
export async function bestTurn(old: Buffer, fresh: Buffer): Promise<Quarter> {
  const alpha = (buf: Buffer, deg: number) => sharp(buf).rotate(deg).ensureAlpha().resize(32, 32, { fit: "fill" }).extractChannel(3).raw().toBuffer();
  const light = (buf: Buffer, deg: number) => sharp(buf).rotate(deg).flatten({ background: "#ffffff" }).greyscale().resize(32, 32, { fit: "fill" }).raw().toBuffer();
  const oldAlpha = await alpha(old, 0);
  const useAlpha = oldAlpha.some((v) => v !== oldAlpha[0]);
  const ref = useAlpha ? oldAlpha : await light(old, 0);
  let best: Quarter = 0;
  let bestDiff = Infinity;
  for (const deg of [0, 90, 180, 270] as Quarter[]) {
    const view = useAlpha ? await alpha(fresh, deg) : await light(fresh, deg);
    let diff = 0;
    for (let i = 0; i < ref.length && i < view.length; i++) diff += Math.abs(ref[i] - view[i]);
    if (diff < bestDiff) { bestDiff = diff; best = deg; }
  }
  return best;
}

/**
 * Server start: a short wait so the health check goes first, then one pass, with a one-line summary in the log;
 * while pieces are left, another pass every `retryMs`. Never throws.
 */
export async function untidyOnStart(delayMs = 5000, retryMs = UNTIDY_RETRY_MS): Promise<void> {
  await new Promise<void>((resolve) => { const t = setTimeout(resolve, delayMs); (t as { unref?: () => void }).unref?.(); });
  try {
    const r = await untidyAll({ log: (line) => console.log(line) });
    if (r.recut || r.skipped || r.failed) console.log(`untidy: ${r.recut} re-cut, ${r.skipped} skipped, ${r.failed} left for later${r.done ? "; done" : ""}`);
    if (!r.done) {
      console.log(`untidy: the rest again in ${Math.round(retryMs / 60_000)} min, or now from Admin → Rules`);
      void untidyOnStart(retryMs, retryMs);
    }
  } catch (e) {
    console.error("untidy: failed", e);
  }
}

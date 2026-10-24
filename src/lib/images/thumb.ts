import sharp from "sharp";

/** Straightens EXIF rotation and caps the long edge; the phone also resizes, this is the server-side guarantee. */
export async function normalizeOriginal(input: Buffer, maxEdge = 1600): Promise<Buffer> {
  return sharp(input).rotate().resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
}

/** Square-ish grid thumbnail on white (cutouts keep their transparency flattened to paper). */
export async function makeThumb(input: Buffer, size = 400): Promise<Buffer> {
  return sharp(input).rotate().flatten({ background: "#ffffff" }).resize(size, size, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

/** What Claude sees: ≤1024px JPEG keeps vision tokens small. */
export async function toAiImage(input: Buffer): Promise<{ data: string; mediaType: "image/jpeg" }> {
  const buf = await sharp(input).rotate().flatten({ background: "#ffffff" }).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return { data: buf.toString("base64"), mediaType: "image/jpeg" };
}

/**
 * A cutout keeps the empty margin of the photo it came from, so the piece sits small in any box.
 * Trim the transparent border and leave a slim, even margin so the piece fills the frame.
 */
export async function fitCutout(png: Buffer, marginPct = 0.04): Promise<Buffer> {
  try {
    const meta = await sharp(png).metadata();
    const trimmed = await sharp(png).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 10 }).toBuffer({ resolveWithObject: true });
    if (trimmed.info.width === meta.width && trimmed.info.height === meta.height) return png; // no margin to take
    const pad = Math.max(4, Math.round(Math.max(trimmed.info.width, trimmed.info.height) * marginPct));
    return await sharp(trimmed.data).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  } catch {
    return png; // nothing to trim (fully transparent or opaque): keep as is
  }
}

export async function imageSize(input: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(input).rotate().metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

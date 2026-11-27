import sharp from "sharp";

/**
 * Straightens EXIF rotation and caps the long edge; the phone also resizes, this is the server-side guarantee.
 * A PNG with a see-through background (a store product shot) is laid on white first: JPEG has no transparency and
 * sharp would otherwise drop it onto black (review B E13).
 */
export async function normalizeOriginal(input: Buffer, maxEdge = 1600): Promise<Buffer> {
  return sharp(input).rotate().flatten({ background: "#ffffff" }).resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
}

/**
 * Stands in for a photo a store would not hand over (review B, store/add.ts): a bone card with a hanger line, so the
 * piece still has a tile in the closet until the person adds their own picture. Tagging skips it; the store facts
 * carry the piece.
 */
export async function placeholderPhoto(width = 600, height = 800): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 600 800">
    <rect width="600" height="800" fill="#f4f4f2"/>
    <g fill="none" stroke="#c9c8c3" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
      <path d="M300 250c0-40 30-60 60-60s60 20 60 60-40 50-60 80v40"/>
      <path d="M300 370 110 500c-20 14-10 40 12 40h356c22 0 32-26 12-40L300 370z"/>
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
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

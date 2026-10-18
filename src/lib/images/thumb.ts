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

export async function imageSize(input: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(input).rotate().metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

import sharp from "sharp";

/** Turns a photo by a quarter turn (degrees clockwise), keeping transparency for PNG cutouts. */
export async function rotateImage(input: Buffer, degrees: 90 | 180 | 270, contentType: "image/png" | "image/jpeg"): Promise<Buffer> {
  const s = sharp(input).rotate().rotate(degrees);
  return contentType === "image/png" ? s.png().toBuffer() : s.jpeg({ quality: 88 }).toBuffer();
}

export type RotateDirection = "right" | "left";
export const quarterTurn = (dir: RotateDirection): 90 | 270 => (dir === "right" ? 90 : 270);

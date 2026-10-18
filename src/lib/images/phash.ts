import sharp from "sharp";

/** 64-bit average hash (8×8 grayscale on white) as 16 hex chars. Close enough to catch the same garment photographed twice. */
export async function phash(input: Buffer): Promise<string> {
  const { data } = await sharp(input)
    .flatten({ background: "#ffffff" })
    .grayscale()
    .resize(8, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = Array.from(data);
  const mean = px.reduce((a, b) => a + b, 0) / px.length;
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b++) nibble = (nibble << 1) | (px[i + b] > mean ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

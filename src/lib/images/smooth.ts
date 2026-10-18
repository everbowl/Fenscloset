import sharp from "sharp";
import { accessToken } from "@/lib/tryon/google";

/**
 * Smooths the wrinkles out of a garment photo with Google's image editor on Vertex (Gemini 2.5 Flash
 * Image), using the same service account as try-on. Never automatic: the confirm card offers it per
 * photo and shows the result next to the original. Env, all in Railway:
 *   GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_VERTEX_PROJECT   (shared with try-on)
 *   GOOGLE_VERTEX_SMOOTH_MODEL     default gemini-2.5-flash-image
 *   GOOGLE_VERTEX_SMOOTH_LOCATION  default global
 * MOCK_SMOOTH=true blurs the photo instead, so the flow can be tested without Google.
 */

export class SmoothError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "SmoothError";
  }
}

const PROMPT = "Smooth out every wrinkle, crease and fold in this garment so the fabric lies perfectly flat, as if it had just been steamed. Change nothing else: keep the exact same shape, cut, size, color, print, graphic, lettering, seams, stitching, framing and background. Do not add, remove, move or restyle anything. Return only the edited photo.";

export function isSmoothConfigured(): boolean {
  return process.env.MOCK_SMOOTH === "true" || Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_VERTEX_PROJECT);
}

/** One edit call: JPEG in, image bytes out. */
async function googleSmooth(jpeg: Buffer, fetchImpl: typeof fetch): Promise<Buffer> {
  const project = process.env.GOOGLE_VERTEX_PROJECT!;
  const location = process.env.GOOGLE_VERTEX_SMOOTH_LOCATION || "global";
  const model = process.env.GOOGLE_VERTEX_SMOOTH_MODEL || "gemini-2.5-flash-image";
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(fetchImpl)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: jpeg.toString("base64") } }, { text: PROMPT }] }],
      generationConfig: { responseModalities: ["IMAGE"], temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new SmoothError(`Google image edit ${res.status}: ${(await res.text()).slice(0, 200)}`, 502);
  const json = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] };
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new SmoothError("Google returned no image.", 502);
  return Buffer.from(part.inlineData.data, "base64");
}

/**
 * Smooths a garment photo. A cutout (PNG with transparency) is flattened on white for the editor and
 * the result is pasted back into the original silhouette, so the background stays cut out and the
 * outline cannot drift. A plain photo comes back as a JPEG.
 */
export async function smoothGarment(input: Buffer, fetchImpl: typeof fetch = fetch): Promise<{ data: Buffer; contentType: "image/png" | "image/jpeg" }> {
  const src = sharp(input).rotate();
  const meta = await src.metadata();
  const hasAlpha = Boolean(meta.hasAlpha);
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new SmoothError("That photo could not be read.");
  const flat = await sharp(input).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
  const editedBuf = process.env.MOCK_SMOOTH === "true" ? await sharp(flat).blur(2).jpeg().toBuffer() : await googleSmooth(flat, fetchImpl);
  if (!hasAlpha) return { data: await sharp(editedBuf).jpeg({ quality: 90 }).toBuffer(), contentType: "image/jpeg" };
  const original = await sharp(input).rotate().ensureAlpha().raw().toBuffer();
  const edited = await sharp(editedBuf).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const rgba = restoreEdges(edited, original);
  const data = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { data, contentType: "image/png" };
}

/**
 * Inside the silhouette, the editor sometimes pulls a sleeve or shoulder inward and leaves the white
 * paper it was shown on. Where the edit is near-white and the original was not, put the original
 * pixel back, so the outline stays the garment's. Returns RGBA with the original alpha.
 */
export function restoreEdges(editedRgb: Buffer, originalRgba: Buffer): Buffer {
  const n = originalRgba.length / 4;
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const a = originalRgba[i * 4 + 3];
    let r = editedRgb[i * 3], g = editedRgb[i * 3 + 1], b = editedRgb[i * 3 + 2];
    const or = originalRgba[i * 4], og = originalRgba[i * 4 + 1], ob = originalRgba[i * 4 + 2];
    if (a > 0 && Math.min(r, g, b) > 232 && Math.min(or, og, ob) < 225) { r = or; g = og; b = ob; }
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
  }
  return out;
}

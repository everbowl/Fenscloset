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

/**
 * One Gemini image call: zero or more JPEG/PNG inputs plus a prompt, image bytes out. Shared by
 * SMOOTH and the mannequin (src/lib/tryon/mannequin.ts).
 */
export async function googleImage(images: { data: Buffer; mimeType: "image/jpeg" | "image/png" }[], prompt: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const project = process.env.GOOGLE_VERTEX_PROJECT!;
  const location = process.env.GOOGLE_VERTEX_SMOOTH_LOCATION || "global";
  const model = process.env.GOOGLE_VERTEX_SMOOTH_MODEL || "gemini-2.5-flash-image";
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(fetchImpl)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [...images.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.data.toString("base64") } })), { text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new SmoothError(`Google image ${res.status}: ${(await res.text()).slice(0, 200)}`, 502);
  const json = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] };
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new SmoothError("Google returned no image.", 502);
  return Buffer.from(part.inlineData.data, "base64");
}

/** One edit call: JPEG in, image bytes out. */
async function googleSmooth(jpeg: Buffer, fetchImpl: typeof fetch): Promise<Buffer> {
  return googleImage([{ data: jpeg, mimeType: "image/jpeg" }], PROMPT, fetchImpl);
}

/**
 * Smooths a garment photo. The editor's result is used only for its shading (Jeff, 18 Oct 2026, S B):
 * the piece's own pixels stay, print, color, lettering and cut untouched, and only the light across
 * the fabric is taken from the smoothed version, so the wrinkle shadows lift without the garment
 * changing. A cutout (PNG with transparency) keeps its exact silhouette; a plain photo comes back as
 * a JPEG.
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
  const original = await sharp(input).rotate().ensureAlpha().raw().toBuffer();
  const edited = await sharp(editedBuf).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const rgba = await transferShading(original, edited, width, height);
  if (!hasAlpha) return { data: await sharp(rgba, { raw: { width, height, channels: 4 } }).removeAlpha().jpeg({ quality: 90 }).toBuffer(), contentType: "image/jpeg" };
  return { data: await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer(), contentType: "image/png" };
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Keeps the original garment and takes only the light from the edit: each pixel is the original
 * scaled by the ratio of the edit's local brightness to the original's (both softly blurred, so
 * print and texture are not part of the ratio). Where the editor pulled the garment away and left
 * white paper, or repainted a print in another color, the ratio is 1, so the outline and the print
 * stay the garment's. Returns RGBA with the original alpha.
 */
export async function transferShading(originalRgba: Buffer, editedRgb: Buffer, width: number, height: number): Promise<Buffer> {
  const n = width * height;
  const origLum = Buffer.alloc(n);
  const editLum = Buffer.alloc(n);
  const trustedO = Buffer.alloc(n); // original light on pixels where the edit is trusted, else 0
  const trustedE = Buffer.alloc(n);
  const trusted = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const or = originalRgba[i * 4], og = originalRgba[i * 4 + 1], ob = originalRgba[i * 4 + 2], a = originalRgba[i * 4 + 3];
    const r = editedRgb[i * 3], g = editedRgb[i * 3 + 1], b = editedRgb[i * 3 + 2];
    // outside the cutout the editor saw white paper; treat it as unchanged
    const flatR = a === 0 ? 255 : or, flatG = a === 0 ? 255 : og, flatB = a === 0 ? 255 : ob;
    const o = lum(flatR, flatG, flatB);
    const e = lum(r, g, b);
    // The editor is trusted only where it changed the light, not the color: same hue and chroma,
    // different brightness. White paper where the garment was, or a recolored/repainted print, is not.
    const paper = Math.min(r, g, b) > 232 && Math.min(flatR, flatG, flatB) < 225;
    const lo = o + 1, le = e + 1;
    const recolored = Math.max(Math.abs(r / le - flatR / lo), Math.abs(g / le - flatG / lo), Math.abs(b / le - flatB / lo)) > 0.35;
    const ok = a > 0 && !paper && !recolored;
    trusted[i] = ok ? 1 : 0;
    origLum[i] = Math.round(o);
    editLum[i] = Math.round(ok ? e : o);
    trustedO[i] = ok ? Math.round(o) : 0;
    trustedE[i] = ok ? Math.round(e) : 0;
  }
  const blur = (buf: Buffer, sigma: number) => sharp(buf, { raw: { width, height, channels: 1 } }).blur(sigma).toColourspace("b-w").raw().toBuffer();
  const sigma = Math.max(1.5, Math.min(width, height) / 80);
  const wide = Math.max(4, Math.min(width, height) / 20); // reach across a print from the fabric around it
  const [bo, be, wo, we] = await Promise.all([blur(origLum, sigma), blur(editLum, sigma), blur(trustedO, wide), blur(trustedE, wide)]);
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    // trusted pixel: its own local light; untrusted (print, paper): the light of the trusted fabric around it
    const ratio = trusted[i] ? (be[i] + 2) / (bo[i] + 2) : wo[i] > 4 ? we[i] / wo[i] : 1;
    const k = Math.min(2, Math.max(0.5, ratio));
    out[i * 4] = Math.min(255, Math.round(originalRgba[i * 4] * k));
    out[i * 4 + 1] = Math.min(255, Math.round(originalRgba[i * 4 + 1] * k));
    out[i * 4 + 2] = Math.min(255, Math.round(originalRgba[i * 4 + 2] * k));
    out[i * 4 + 3] = originalRgba[i * 4 + 3];
  }
  return out;
}

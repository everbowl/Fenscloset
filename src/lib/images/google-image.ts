import { accessToken, fetchWithBackoff } from "@/lib/tryon/google";

/**
 * One call to Google's image model on Vertex (Gemini 2.5 Flash Image), with the same service account as
 * try-on. Used by the mannequin and by the mirror's styling pass. Env, all in Railway:
 *   GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_VERTEX_PROJECT   (shared with try-on)
 *   GOOGLE_VERTEX_IMAGE_MODEL      default gemini-2.5-flash-image (GOOGLE_VERTEX_SMOOTH_MODEL still read)
 *   GOOGLE_VERTEX_IMAGE_LOCATION   default global (GOOGLE_VERTEX_SMOOTH_LOCATION still read)
 * MOCK_GOOGLE_IMAGE=true counts as configured, so the flows can be tested without Google.
 *
 * Tidy and Smooth wrinkles (garment photo retouching) lived here until 19 Oct 2026; Jeff: "remove Tidy for
 * now, doesn't work and don't want it". Gone from the app; git history has them.
 */

export class GoogleImageError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "GoogleImageError";
  }
}

export function isGoogleImageConfigured(): boolean {
  return process.env.MOCK_GOOGLE_IMAGE === "true" || Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_VERTEX_PROJECT);
}

/**
 * After Google answers 429 (quota) even after the backoff, the image model is left alone for GOOGLE_IMAGE_HOLD_MS
 * (five minutes): the mirror's second dressing and styling pass are skipped with a note and the plain try-on is shown
 * at once, instead of each call waiting through the backoff only to fail (Jeff, 23 Oct 2026: four quota failures in
 * one evening, 20 to 40 seconds lost on each).
 */
let holdUntil = 0;
const holdMs = () => Number(process.env.GOOGLE_IMAGE_HOLD_MS ?? 5 * 60_000);
export function googleImageOnHold(): boolean {
  return Date.now() < holdUntil;
}
/** Tests: forget the hold. */
export function clearGoogleImageHold(): void {
  holdUntil = 0;
}

/** Zero or more JPEG/PNG inputs plus a prompt, image bytes out. */
export async function googleImage(images: { data: Buffer; mimeType: "image/jpeg" | "image/png" }[], prompt: string, fetchImpl: typeof fetch = fetch, opts: { /** An adult's own body picture (the try-on styling pass): Google's filters are loosened for it (Jeff, 19 Oct 2026). Never set for a minor's look, the mannequin or garment photos, which keep Google's defaults. */ relaxed?: boolean } = {}): Promise<Buffer> {
  if (googleImageOnHold()) throw new GoogleImageError(`Google’s image model is out of quota; not called again until ${new Date(holdUntil).toISOString().slice(11, 16)} UTC.`, 429);
  const project = process.env.GOOGLE_VERTEX_PROJECT!;
  const location = process.env.GOOGLE_VERTEX_IMAGE_LOCATION || process.env.GOOGLE_VERTEX_SMOOTH_LOCATION || "global";
  const model = process.env.GOOGLE_VERTEX_IMAGE_MODEL || process.env.GOOGLE_VERTEX_SMOOTH_MODEL || "gemini-2.5-flash-image";
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  // Relaxed (an adult's own body picture): the filters go as far off as Google lets this project. OFF first, then BLOCK_NONE,
  // then BLOCK_ONLY_HIGH (never needs approval), then Google's defaults; a 400 on one level means the next is tried.
  // GOOGLE_VERTEX_IMAGE_SAFETY pins the first level. Not relaxed: Google's defaults, nothing sent.
  const CATEGORIES = ["HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_DANGEROUS_CONTENT"];
  const thresholds: (string | null)[] = opts.relaxed ? [...new Set([process.env.GOOGLE_VERTEX_IMAGE_SAFETY || "OFF", "BLOCK_NONE", "BLOCK_ONLY_HIGH"]), null] : [null];
  const token = await accessToken(fetchImpl);
  let res: Response | null = null;
  for (const [i, threshold] of thresholds.entries()) {
    res = await fetchWithBackoff(fetchImpl, url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [...images.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.data.toString("base64") } })), { text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"], temperature: 0.2 },
        ...(threshold ? { safetySettings: CATEGORIES.map((category) => ({ category, threshold })) } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (res.status === 400 && i < thresholds.length - 1) { console.log(`image: Google refused safety threshold ${threshold}; trying ${thresholds[i + 1] ?? "defaults"}`); continue; }
    if (res.ok && opts.relaxed && i > 0) console.log(`image: safety threshold ${threshold ?? "defaults"}`);
    break;
  }
  if (!res) throw new GoogleImageError("Google image: nothing to call", 502);
  if (res.status === 429) {
    holdUntil = Date.now() + holdMs();
    console.log(`image: Google 429 (quota); the image model is left alone for ${Math.round(holdMs() / 60_000)} min`);
    throw new GoogleImageError("Google’s image model is out of quota (429).", 429);
  }
  if (!res.ok) throw new GoogleImageError(`Google image ${res.status}: ${(await res.text()).slice(0, 200)}`, 502);
  const json = (await res.json()) as { candidates?: { finishReason?: string; content?: { parts?: { inlineData?: { data?: string } }[] } }[]; promptFeedback?: { blockReason?: string } };
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new GoogleImageError(`Google returned no image${json.promptFeedback?.blockReason ? ` (blocked: ${json.promptFeedback.blockReason})` : json.candidates?.[0]?.finishReason ? ` (${json.candidates[0].finishReason})` : ""}.`, 502);
  return Buffer.from(part.inlineData.data, "base64");
}

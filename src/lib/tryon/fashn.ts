import sharp from "sharp";
import { fetchWithBackoff } from "@/lib/tryon/google";

/**
 * FASHN virtual try-on (https://fashn.ai): the second mirror engine beside Google (Jeff, 20 Oct 2026, A). One
 * garment onto one person image per call. What makes it the one for "my true body": segmentation-free dressing,
 * which paints a garment onto skin as readily as over clothes, so a swimwear base photo works; and a permissive
 * moderation level, which allows swimwear, underwear and lingerie on adults. Never nudity: FASHN's terms, the same
 * line as Google's. Minors never reach this call (src/lib/tryon/index.ts assertReady). Env, all in Railway:
 *   FASHN_API_KEY            the key from https://app.fashn.ai (API)
 *   FASHN_MODEL              default tryon-v1.6
 *   FASHN_MODE               performance | balanced | quality, default balanced
 *   FASHN_MODERATION         conservative | permissive | none, default permissive
 *   FASHN_SEGMENTATION_FREE  default true; "false" dresses by detected clothing only, like Google
 * MOCK_FASHN=true pastes the garment on instead, warmer than Google's mock so a comparison shows two pictures.
 */

export class FashnError extends Error {
  constructor(message: string, public readonly status = 502, public readonly code?: string) {
    super(message);
    this.name = "FashnError";
  }
}

export const FASHN_API = "https://api.fashn.ai/v1";
export type FashnCategory = "tops" | "bottoms" | "one-pieces" | "auto";

export function isFashnConfigured(): boolean {
  return process.env.MOCK_FASHN === "true" || Boolean(process.env.FASHN_API_KEY);
}

/** Our categories to FASHN's. Shoes come back null: FASHN does not place them. Anything else, FASHN decides. */
export function fashnCategory(category: string | null | undefined): FashnCategory | null {
  switch (category) {
    case "Tops": case "Outerwear": return "tops";
    case "Bottoms": return "bottoms";
    case "Dresses": return "one-pieces";
    case "Shoes": return null;
    default: return "auto";
  }
}

const dataUri = (buf: Buffer, mime: string) => `data:${mime};base64,${buf.toString("base64")}`;

type RunResponse = { id?: string; error?: unknown };
type StatusResponse = { id?: string; status?: string; output?: string[]; error?: { name?: string; message?: string } | string | null };

function errorText(e: unknown): string {
  if (!e) return "";
  if (typeof e === "string") return e;
  const o = e as { name?: string; message?: string };
  return [o.name, o.message].filter(Boolean).join(": ");
}

/** A message a person can act on, from FASHN's error names. */
function friendly(e: unknown): FashnError {
  const text = errorText(e);
  if (/ContentModeration/i.test(text)) return new FashnError("FASHN’s filters refused this picture.", 422, "moderation");
  if (/Pose/i.test(text)) return new FashnError("FASHN could not make out the body in this photo. A full-body photo, facing the camera, works best.", 422, "pose");
  if (/ImageLoad/i.test(text)) return new FashnError("FASHN could not read one of the pictures.", 422, "image");
  return new FashnError(`FASHN: ${text || "unknown error"}`, 502);
}

/** The picture, whether it came back inline (base64) or as a link. */
async function outputBytes(out: string, fetchImpl: typeof fetch): Promise<{ data: Buffer; mimeType: string }> {
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(out);
  if (m) return { data: Buffer.from(m[2], "base64"), mimeType: m[1] };
  const res = await fetchImpl(out, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new FashnError(`FASHN picture ${res.status}`, 502);
  return { data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "image/jpeg" };
}

/** One garment onto one person image → image bytes. A job is started, then polled every FASHN_POLL_MS (2 s) until it is done. */
export async function fashnTryOn(person: Buffer, garment: Buffer, category: FashnCategory, fetchImpl: typeof fetch = fetch): Promise<{ data: Buffer; mimeType: string }> {
  if (process.env.MOCK_FASHN === "true") return { data: await mockFashn(person, garment), mimeType: "image/jpeg" };
  const key = process.env.FASHN_API_KEY;
  if (!key) throw new FashnError("FASHN isn’t set up yet: FASHN_API_KEY is not in Railway.", 503, "no_key");
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const body = JSON.stringify({
    model_name: process.env.FASHN_MODEL || "tryon-v1.6",
    inputs: {
      model_image: dataUri(person, "image/jpeg"),
      garment_image: dataUri(garment, "image/jpeg"),
      category,
      mode: process.env.FASHN_MODE || "balanced",
      garment_photo_type: "auto",
      moderation_level: process.env.FASHN_MODERATION || "permissive",
      segmentation_free: process.env.FASHN_SEGMENTATION_FREE !== "false",
      output_format: "jpeg",
      return_base64: true,
    },
  });
  const run = await fetchWithBackoff(fetchImpl, `${FASHN_API}/run`, { method: "POST", headers, body, signal: AbortSignal.timeout(30_000) });
  if (run.status === 401 || run.status === 403) throw new FashnError(`FASHN refused the key (${run.status}). Check FASHN_API_KEY in Railway.`, 503, "key");
  if (run.status === 402) throw new FashnError("FASHN is out of credits.", 503, "credits");
  if (!run.ok) { const text = (await run.text()).slice(0, 300); console.error(`fashn: run ${run.status}: ${text}`); throw new FashnError(`FASHN ${run.status}: ${text}`, 502); }
  const started = (await run.json()) as RunResponse;
  if (started.error) throw friendly(started.error);
  if (!started.id) throw new FashnError("FASHN returned no job id.", 502);
  const pollMs = Number(process.env.FASHN_POLL_MS ?? 2000);
  const deadline = Date.now() + Number(process.env.FASHN_TIMEOUT_MS ?? 180_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const res = await fetchWithBackoff(fetchImpl, `${FASHN_API}/status/${started.id}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) { const text = (await res.text()).slice(0, 300); console.error(`fashn: status ${res.status}: ${text}`); throw new FashnError(`FASHN status ${res.status}: ${text}`, 502); }
    const s = (await res.json()) as StatusResponse;
    if (s.status === "failed") { console.error(`fashn: job ${started.id} failed: ${errorText(s.error)}`); throw friendly(s.error); }
    if (s.status === "completed") {
      const out = s.output?.[0];
      if (!out) throw new FashnError("FASHN returned no image.", 502);
      return outputBytes(out, fetchImpl);
    }
  }
  throw new FashnError("FASHN took too long.", 504, "timeout");
}

/** Dev/test stand-in: the body photo with the garment pasted on, warmer than Google's mock so a comparison shows two pictures. */
export async function mockFashn(person: Buffer, garment: Buffer): Promise<Buffer> {
  const g = await sharp(garment).flatten({ background: "#ffffff" }).resize(260, 260, { fit: "inside" }).png().toBuffer();
  return sharp(person).rotate().resize(600, 800, { fit: "cover" }).modulate({ hue: 20, saturation: 1.1 }).composite([{ input: g, left: 300, top: 160 }]).jpeg({ quality: 85 }).toBuffer();
}

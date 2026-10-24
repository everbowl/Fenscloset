import { createHmac } from "node:crypto";
import sharp from "sharp";
import { fetchWithBackoff } from "@/lib/tryon/google";

/**
 * Kling (Kolors) virtual try-on, Kuaishou's engine (https://klingai.com): the third mirror engine beside Google and
 * FASHN (Jeff, 24 Oct 2026: "add Kling"). One garment onto one person image per call; it works out whether the
 * garment is a top, a bottom or a one-piece by itself; it does not place shoes. Minors never reach this call
 * (src/lib/tryon/index.ts assertReady). Env, all in Railway:
 *   KLING_ACCESS_KEY, KLING_SECRET_KEY  the pair from the Kling developer console (API Keys)
 *   KLING_API_BASE                      default https://api-singapore.klingai.com (Kling's global API)
 *   KLING_MODEL                         default kolors-virtual-try-on-v1-5
 * Auth is a short-lived JWT (HS256, iss = the access key) signed with the secret key, sent as a Bearer token.
 * MOCK_KLING=true pastes the garment on instead, cooler than the other mocks so a comparison shows three pictures.
 */

export class KlingError extends Error {
  constructor(message: string, public readonly status = 502, public readonly code?: string) {
    super(message);
    this.name = "KlingError";
  }
}

export const KLING_PATH = "/v1/images/kolors-virtual-try-on";
export const klingBase = () => (process.env.KLING_API_BASE || "https://api-singapore.klingai.com").replace(/\/$/, "");

export function isKlingConfigured(): boolean {
  return process.env.MOCK_KLING === "true" || Boolean(process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY);
}

const b64url = (s: Buffer | string) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** Kling's API token: a JWT signed with the secret key, good for 30 minutes, valid from a few seconds ago (clock skew). */
export function klingToken(accessKey: string, secretKey: string, nowMs = Date.now()): string {
  const now = Math.floor(nowMs / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 }));
  const sig = b64url(createHmac("sha256", secretKey).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

type CreateResponse = { code?: number; message?: string; request_id?: string; data?: { task_id?: string; task_status?: string } };
type QueryResponse = { code?: number; message?: string; data?: { task_id?: string; task_status?: string; task_status_msg?: string; task_result?: { images?: { index?: number; url?: string }[] } } };

/** A message a person can act on, from Kling's codes and words. */
function friendly(code: number | undefined, text: string | undefined): KlingError {
  const t = text ?? "";
  if (code !== undefined && code >= 1000 && code < 1100) return new KlingError(`Kling refused the keys (${code}). Check KLING_ACCESS_KEY and KLING_SECRET_KEY in Railway.`, 503, "key");
  if (code !== undefined && code >= 1100 && code < 1200) return new KlingError("Kling is out of credits.", 503, "credits");
  if (code === 1301 || code === 1302 || /risk|sensitive|content|moderation|policy/i.test(t)) return new KlingError("Kling’s filters refused this picture.", 422, "moderation");
  if (code === 1303 || code === 1304) return new KlingError("Kling is busy right now. Try again in a minute.", 503, "busy");
  if (/human|person|body|pose|face/i.test(t)) return new KlingError("Kling could not make out the body in this photo. A full-body photo, facing the camera, works best.", 422, "pose");
  if (/cloth|garment|image/i.test(t)) return new KlingError("Kling could not read one of the pictures.", 422, "image");
  return new KlingError(`Kling: ${t || `error ${code ?? "?"}`}`, 502);
}

/** One garment onto one person image → image bytes. A task is created, then polled every KLING_POLL_MS (2 s) until it is done. */
export async function klingTryOn(person: Buffer, garment: Buffer, fetchImpl: typeof fetch = fetch): Promise<{ data: Buffer; mimeType: string }> {
  if (process.env.MOCK_KLING === "true") return { data: await mockKling(person, garment), mimeType: "image/jpeg" };
  const ak = process.env.KLING_ACCESS_KEY, sk = process.env.KLING_SECRET_KEY;
  if (!ak || !sk) throw new KlingError("Kling isn’t set up yet: KLING_ACCESS_KEY and KLING_SECRET_KEY are not in Railway.", 503, "no_key");
  const headers = { Authorization: `Bearer ${klingToken(ak, sk)}`, "Content-Type": "application/json" };
  // Kling takes plain base64 (no data: prefix) or a URL; the pictures stay ours, so base64.
  const body = JSON.stringify({ model_name: process.env.KLING_MODEL || "kolors-virtual-try-on-v1-5", human_image: person.toString("base64"), cloth_image: garment.toString("base64") });
  const run = await fetchWithBackoff(fetchImpl, `${klingBase()}${KLING_PATH}`, { method: "POST", headers, body, signal: AbortSignal.timeout(30_000) });
  if (run.status === 401 || run.status === 403) throw new KlingError(`Kling refused the keys (${run.status}). Check KLING_ACCESS_KEY and KLING_SECRET_KEY in Railway.`, 503, "key");
  const text = await run.text();
  let started: CreateResponse;
  try { started = JSON.parse(text) as CreateResponse; } catch { console.error(`kling: create ${run.status}: ${text.slice(0, 300)}`); throw new KlingError(`Kling ${run.status}: ${text.slice(0, 120)}`, 502); }
  if (!run.ok || (started.code !== undefined && started.code !== 0)) { console.error(`kling: create ${run.status} code ${started.code}: ${started.message}`); throw friendly(started.code, started.message); }
  const taskId = started.data?.task_id;
  if (!taskId) throw new KlingError("Kling returned no task id.", 502);
  const pollMs = Number(process.env.KLING_POLL_MS ?? 2000);
  const deadline = Date.now() + Number(process.env.KLING_TIMEOUT_MS ?? 180_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const res = await fetchWithBackoff(fetchImpl, `${klingBase()}${KLING_PATH}/${taskId}`, { headers: { Authorization: headers.Authorization }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) { const t = (await res.text()).slice(0, 300); console.error(`kling: query ${res.status}: ${t}`); throw new KlingError(`Kling status ${res.status}: ${t}`, 502); }
    const q = (await res.json()) as QueryResponse;
    if (q.code !== undefined && q.code !== 0) throw friendly(q.code, q.message);
    const status = q.data?.task_status;
    if (status === "failed") { console.error(`kling: task ${taskId} failed: ${q.data?.task_status_msg}`); throw friendly(undefined, q.data?.task_status_msg); }
    if (status === "succeed") {
      const url = q.data?.task_result?.images?.[0]?.url;
      if (!url) throw new KlingError("Kling returned no image.", 502);
      const pic = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
      if (!pic.ok) throw new KlingError(`Kling picture ${pic.status}`, 502);
      return { data: Buffer.from(await pic.arrayBuffer()), mimeType: pic.headers.get("content-type") ?? "image/jpeg" };
    }
  }
  throw new KlingError("Kling took too long.", 504, "timeout");
}

/** Dev/test stand-in: the body photo with the garment pasted on, cooler than the other mocks so a comparison shows three pictures. */
export async function mockKling(person: Buffer, garment: Buffer): Promise<Buffer> {
  const g = await sharp(garment).flatten({ background: "#ffffff" }).resize(260, 260, { fit: "inside" }).png().toBuffer();
  return sharp(person).rotate().resize(600, 800, { fit: "cover" }).modulate({ hue: -40, saturation: 0.95 }).composite([{ input: g, left: 40, top: 160 }]).jpeg({ quality: 85 }).toBuffer();
}

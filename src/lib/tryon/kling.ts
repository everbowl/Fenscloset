import { createHmac } from "node:crypto";
import sharp from "sharp";
import { fetchWithBackoff } from "@/lib/tryon/google";
import { deleteObject, newKey, putObject, signDownload } from "@/lib/storage";

/**
 * Kling virtual try-on, Kuaishou's engine (https://kling.ai): the third mirror engine beside Google and FASHN (Jeff,
 * 24 Oct 2026: "add Kling"). This is Kling's Virtual Try-on 3.0 (15 Sept 2026); the Kolors endpoint it replaced
 * answers "404, 1203: This API is no longer available" since. Kling 3.0 reads the two pictures **by link**, so each one
 * sits in the bucket under tryon/<personId>/… for the length of the task, goes over as a signed link, and is removed as
 * soon as Kling has answered. The person's face, pose and background are kept. One garment onto one person per call;
 * it works out whether the garment is a top, a bottom or a one-piece by itself; it does not place shoes. Minors never
 * reach this call (src/lib/tryon/index.ts assertReady). Env, all in Railway:
 *   KLING_API_KEY                       the one API key the Kling console issues: sent as it is
 *   KLING_ACCESS_KEY, KLING_SECRET_KEY  the older access-key / secret-key pair: signed into a short-lived JWT
 *   KLING_API_BASE                      default https://api-singapore.klingai.com (Kling's global API)
 *   KLING_POLL_MS, KLING_TIMEOUT_MS     how often the task is asked after (2 s) and how long we wait (180 s)
 * Either key goes as a Bearer token; with both set, the API key wins. The photo bucket (S3_*) has to be set too: a
 * link into it is what Kling fetches. MOCK_KLING=true pastes the garment on instead, cooler than the other mocks so a
 * comparison shows three pictures.
 */

export class KlingError extends Error {
  constructor(message: string, public readonly status = 502, public readonly code?: string) {
    super(message);
    this.name = "KlingError";
  }
}

export const KLING_CREATE_PATH = "/solutions/virtual_try_on";
export const KLING_QUERY_PATH = "/solutions";
/** How long the signed links to the two pictures stay good: longer than any task we wait for. */
const LINK_TTL_S = 15 * 60;
export const klingBase = () => (process.env.KLING_API_BASE || "https://api-singapore.klingai.com").replace(/\/$/, "");

export function isKlingConfigured(): boolean {
  return process.env.MOCK_KLING === "true" || Boolean(process.env.KLING_API_KEY) || Boolean(process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY);
}

/** The Authorization value: the API key as it is, else a token signed from the access-key / secret-key pair; null without either. */
export function klingAuth(env: Record<string, string | undefined> = process.env): string | null {
  if (env.KLING_API_KEY) return `Bearer ${env.KLING_API_KEY}`;
  if (env.KLING_ACCESS_KEY && env.KLING_SECRET_KEY) return `Bearer ${klingToken(env.KLING_ACCESS_KEY, env.KLING_SECRET_KEY)}`;
  return null;
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

type CreateResponse = { code?: number; message?: string; request_id?: string; data?: { task_id?: string; status?: string } };
type QueryTask = { id?: string; status?: string; message?: string; outputs?: { type?: string; url?: string }[]; billing?: { charge_type?: string; amount?: string; package_type?: string; cash_type?: string }[] };
type QueryResponse = { code?: number; message?: string; data?: QueryTask[] };

/** A message a person can act on, from Kling's codes and words. */
function friendly(code: number | undefined, text: string | undefined): KlingError {
  const t = text ?? "";
  if (code !== undefined && code >= 1000 && code < 1100) return new KlingError(`Kling refused the key (${code}). Check KLING_API_KEY in Railway, and that API access is turned on in the Kling console.`, 503, "key");
  if (code !== undefined && code >= 1100 && code < 1200) return new KlingError("Kling is out of credits.", 503, "credits");
  if (code === 1203 || /no longer available/i.test(t)) return new KlingError("Kling has moved this API again. Check Kling’s API updates page and tell Claude.", 502, "gone");
  if (code === 1301 || code === 1302 || /risk|sensitive|content|moderation|policy/i.test(t)) return new KlingError("Kling’s filters refused this picture.", 422, "moderation");
  if (code === 1303 || code === 1304) return new KlingError("Kling is busy right now. Try again in a minute.", 503, "busy");
  if (/human|person|body|pose|face/i.test(t)) return new KlingError("Kling could not make out the body in this photo. A full-body photo, facing the camera, works best.", 422, "pose");
  if (/cloth|garment|image|url|download|fetch/i.test(t)) return new KlingError("Kling could not read one of the pictures.", 422, "image");
  return new KlingError(`Kling: ${t || `error ${code ?? "?"}`}`, 502);
}

/** Kling's picture rules: longest side at most 2048, shortest over 300, under 10 MB, JPEG/PNG/WebP. A JPEG on white meets all of them. */
export async function klingPicture(buf: Buffer): Promise<Buffer> {
  const img = sharp(buf).flatten({ background: "#ffffff" });
  const meta = await img.metadata();
  const w = meta.width ?? 0, h = meta.height ?? 0;
  let scale = Math.min(1, 2048 / Math.max(w, h, 1));
  if (Math.min(w, h) * scale <= 300) scale = 320 / Math.max(1, Math.min(w, h));
  const sized = scale === 1 ? img : img.resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  return sized.jpeg({ quality: 90 }).toBuffer();
}

/**
 * One garment onto one person image → image bytes. Both pictures go into the bucket as JPEGs for the length of the task
 * and Kling gets signed links; a task is created, then polled every KLING_POLL_MS (2 s) until it is done; the two
 * objects are removed whatever happens.
 */
export async function klingTryOn(person: Buffer, garment: Buffer, personId: string, fetchImpl: typeof fetch = fetch): Promise<{ data: Buffer; mimeType: string }> {
  if (process.env.MOCK_KLING === "true") return { data: await mockKling(person, garment), mimeType: "image/jpeg" };
  const auth = klingAuth();
  if (!auth) throw new KlingError("Kling isn’t set up yet: KLING_API_KEY is not in Railway.", 503, "no_key");
  const headers = { Authorization: auth, "Content-Type": "application/json" };
  const personKey = newKey("tryon", personId, "image/jpeg");
  const garmentKey = newKey("tryon", personId, "image/jpeg");
  try {
    await Promise.all([putObject(personKey, await klingPicture(person), "image/jpeg"), putObject(garmentKey, await klingPicture(garment), "image/jpeg")]);
    const [personUrl, garmentUrl] = await Promise.all([signDownload(personKey, LINK_TTL_S), signDownload(garmentKey, LINK_TTL_S)]);
    const body = JSON.stringify({
      contents: [{ type: "product_image", url: garmentUrl }, { type: "person_image", url: personUrl }],
      settings: { keep_face: true, keep_pose: true, keep_background: true },
      options: { watermark: { enabled: false } },
    });
    const run = await fetchWithBackoff(fetchImpl, `${klingBase()}${KLING_CREATE_PATH}`, { method: "POST", headers, body, signal: AbortSignal.timeout(30_000) });
    if (run.status === 401 || run.status === 403) throw new KlingError(`Kling refused the key (${run.status}). Check KLING_API_KEY in Railway, and that API access is turned on in the Kling console.`, 503, "key");
    const text = await run.text();
    let started: CreateResponse;
    try { started = JSON.parse(text) as CreateResponse; } catch { console.error(`kling: create ${run.status}: ${text.slice(0, 300)}`); throw new KlingError(`Kling ${run.status}: ${text.slice(0, 120)}`, 502); }
    if (!run.ok || (started.code !== undefined && started.code !== 0)) { console.error(`kling: create ${run.status} code ${started.code}: ${started.message}`); throw friendly(started.code, started.message); }
    const taskId = started.data?.task_id;
    if (!taskId) throw new KlingError("Kling returned no task id.", 502);
    const pollMs = Number(process.env.KLING_POLL_MS ?? 2000);
    const startedAt = Date.now();
    const deadline = startedAt + Number(process.env.KLING_TIMEOUT_MS ?? 180_000);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      const res = await fetchWithBackoff(fetchImpl, `${klingBase()}${KLING_QUERY_PATH}?task_ids=${encodeURIComponent(taskId)}`, { headers: { Authorization: headers.Authorization }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) { const t = (await res.text()).slice(0, 300); console.error(`kling: query ${res.status}: ${t}`); throw new KlingError(`Kling status ${res.status}: ${t}`, 502); }
      const q = (await res.json()) as QueryResponse;
      if (q.code !== undefined && q.code !== 0) throw friendly(q.code, q.message);
      const task = q.data?.find((t) => t.id === taskId) ?? q.data?.[0];
      if (task?.status === "failed") { console.error(`kling: task ${taskId} failed: ${task.message}`); throw friendly(undefined, task.message); }
      if (task?.status === "succeed") {
        // The one line a working Kling leaves in the logs, with what the task cost (credits or cash), so the first live runs can be priced.
        const cost = (task.billing ?? []).map((b) => `${b.amount ?? "?"} ${b.charge_type === "cash" ? (b.cash_type ?? "cash") : (b.package_type ?? "credits")}`).join(" + ");
        console.log(`kling: task ${taskId} done in ${Math.round((Date.now() - startedAt) / 1000)}s${cost ? `, cost ${cost}` : ""}`);
        const url = (task.outputs?.find((o) => o.type === "image") ?? task.outputs?.[0])?.url;
        if (!url) throw new KlingError("Kling returned no image.", 502);
        const pic = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
        if (!pic.ok) throw new KlingError(`Kling picture ${pic.status}`, 502);
        return { data: Buffer.from(await pic.arrayBuffer()), mimeType: pic.headers.get("content-type") ?? "image/jpeg" };
      }
    }
    throw new KlingError("Kling took too long.", 504, "timeout");
  } finally {
    await Promise.all([personKey, garmentKey].map((k) => deleteObject(k).catch(() => undefined))); // the links die with the objects
  }
}

/** Dev/test stand-in: the body photo with the garment pasted on, cooler than the other mocks so a comparison shows three pictures. */
export async function mockKling(person: Buffer, garment: Buffer): Promise<Buffer> {
  const g = await sharp(garment).flatten({ background: "#ffffff" }).resize(260, 260, { fit: "inside" }).png().toBuffer();
  return sharp(person).rotate().resize(600, 800, { fit: "cover" }).modulate({ hue: -40, saturation: 0.95 }).composite([{ input: g, left: 40, top: 160 }]).jpeg({ quality: 85 }).toBuffer();
}

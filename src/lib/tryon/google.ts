import { createSign } from "node:crypto";

/**
 * Google Vertex AI Virtual Try-On, called with a service account (no SDK: a signed JWT exchanged for
 * an access token, then one predict call). Env, all in Railway:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  the service-account key file contents (raw JSON or base64)
 *   GOOGLE_VERTEX_PROJECT        the Google Cloud project id
 *   GOOGLE_VERTEX_LOCATION       default us-central1
 *   GOOGLE_VERTEX_TRYON_MODEL    default virtual-try-on-001 (the preview id is tried next when Google answers 404)
 */

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

/** The project cannot use the model (not enabled, no access): a message a person can act on. */
export class TryOnModelError extends Error { constructor(message: string) { super(message); this.name = "TryOnModelError"; } }

/**
 * Google answers 429 (too many requests this minute) and 503 (busy) for a few seconds at a time, especially when
 * the mirror, the styling pass and the mannequin call in a row. The same request is sent again after a short wait, three times.
 * MOCK_BACKOFF_MS shortens the waits in tests.
 */
export async function fetchWithBackoff(fetchImpl: typeof fetch, url: string, init: RequestInit, tries = 4): Promise<Response> {
  const base = Number(process.env.MOCK_BACKOFF_MS ?? 1500);
  let res = await fetchImpl(url, init);
  for (let i = 1; i < tries && (res.status === 429 || res.status === 503); i++) {
    console.log(`${new URL(url).hostname}: ${res.status}, waiting ${base * 2 ** (i - 1)}ms before try ${i + 1}`);
    await new Promise((r) => setTimeout(r, base * 2 ** (i - 1)));
    res = await fetchImpl(url, init);
  }
  return res;
}

export function isGoogleTryOnConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_VERTEX_PROJECT);
}

function serviceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const sa = JSON.parse(text) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key");
  return sa;
}

let cached: { token: string; expiresAt: number } | null = null;

/** OAuth2 access token for the service account, cached until a minute before expiry. */
export async function accessToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: sa.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetchImpl(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

/** One garment onto one person image → JPEG/PNG bytes. */
export async function googleTryOn(person: Buffer, garment: Buffer, fetchImpl: typeof fetch = fetch): Promise<{ data: Buffer; mimeType: string }> {
  const project = process.env.GOOGLE_VERTEX_PROJECT!;
  const location = process.env.GOOGLE_VERTEX_LOCATION || "us-central1";
  const models = [...new Set([process.env.GOOGLE_VERTEX_TRYON_MODEL || "virtual-try-on-001", "virtual-try-on-001", "virtual-try-on-preview-08-04"])];
  // Jeff, 19 Oct 2026: no visual restrictions on his own body photos; minors never reach this call (tryOnState). The loosest
  // level goes first: block_none needs Google's allowlist and is refused (400) until the project is approved, so the next
  // level down is tried, block_only_high, which needs no approval. GOOGLE_VERTEX_TRYON_SAFETY pins a level.
  const levels = [...new Set([process.env.GOOGLE_VERTEX_TRYON_SAFETY || "block_none", "block_only_high"])];
  // baseSteps: Google's diffusion steps, default 32; more is a better picture for a longer wait (Jeff, 23 Oct 2026: quality over
  // speed, the mirror runs in the background anyway). GOOGLE_VERTEX_TRYON_STEPS overrides.
  const baseSteps = Math.max(1, Math.round(Number(process.env.GOOGLE_VERTEX_TRYON_STEPS) || 50));
  const bodyFor = (safetySetting: string) => JSON.stringify({
    instances: [{ personImage: { image: { bytesBase64Encoded: person.toString("base64") } }, productImages: [{ image: { bytesBase64Encoded: garment.toString("base64") } }] }],
    parameters: { sampleCount: 1, baseSteps, personGeneration: process.env.GOOGLE_VERTEX_TRYON_PERSON || "allow_adult", safetySetting, addWatermark: false },
  });
  const token = await accessToken(fetchImpl);
  let res: Response | null = null;
  outer: for (const model of models) {
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`;
    for (const [i, level] of levels.entries()) {
      res = await fetchWithBackoff(fetchImpl, url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: bodyFor(level), signal: AbortSignal.timeout(90_000) });
      if (res.status === 404) continue outer; // this model id is not on for the project; try the next id
      if (res.status === 400 && i < levels.length - 1) { console.log(`tryon: Google refused safetySetting ${level}; trying ${levels[i + 1]}`); continue; }
      if (res.ok && i > 0) console.log(`tryon: safetySetting ${level}`);
      break outer;
    }
  }
  if (!res) throw new Error("Vertex try-on: no model to call");
  if (res.status === 404 || res.status === 403) throw new TryOnModelError(`Google's try-on model isn't turned on for project ${project} yet (${res.status}). Enable Vertex AI and the Virtual Try-On model, then try again.`);
  if (!res.ok) throw new Error(`Vertex try-on ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { predictions?: { bytesBase64Encoded?: string; mimeType?: string }[] };
  const p = json.predictions?.[0];
  if (!p?.bytesBase64Encoded) throw new Error("Vertex try-on returned no image");
  return { data: Buffer.from(p.bytesBase64Encoded, "base64"), mimeType: p.mimeType ?? "image/png" };
}

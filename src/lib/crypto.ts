import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** AES-256-GCM with a key derived from SESSION_SECRET. Used for the Google refresh token at rest. */
function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv.toString("base64url"), enc.toString("base64url"), c.getAuthTag().toString("base64url")].join(".");
}

export function decrypt(packed: string): string {
  const [iv, enc, tag] = packed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

/** Short signed state for OAuth round-trips: `<payload>.<sig>`. */
export function sign(payload: string): string {
  return `${payload}.${createHmac("sha256", key()).update(payload).digest("base64url")}`;
}

export function verify(signed: string): string | null {
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const payload = signed.slice(0, i), sig = signed.slice(i + 1);
  const want = createHmac("sha256", key()).update(payload).digest("base64url");
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  return payload;
}

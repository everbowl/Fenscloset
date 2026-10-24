/**
 * Photo storage. Production: the Railway bucket over the S3 API. Tests and local dev without
 * bucket credentials: a folder on disk (MOCK_S3=true or no S3_ENDPOINT).
 *
 * Keys are always `<kind>/<ownerPersonId>/<id>.<ext>` so visibility checks can read the owner
 * off the key without a lookup. Browsers never get bucket URLs: reads go through /api/photo,
 * uploads through /api/uploads/put (a short-lived signed relay), or straight to the bucket when
 * S3_DIRECT_UPLOADS=true (requires CORS on the bucket).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const PHOTO_KINDS = ["originals", "cutouts", "thumbs", "labels", "worn", "avatars", "bodies", "checkins", "fits", "shop", "inspo", "tryon", "mannequin"] as const;
export type PhotoKeyKind = (typeof PHOTO_KINDS)[number];
export const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const EXT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const KEY_RE = new RegExp(`^(${PHOTO_KINDS.join("|")})/([a-z0-9]{10,40})/([a-z0-9]{10,40})\\.(jpg|png|webp)$`);

export type ParsedKey = { kind: PhotoKeyKind; ownerId: string; file: string; ext: string; contentType: string };

export function parseKey(key: string): ParsedKey | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  return { kind: m[1] as PhotoKeyKind, ownerId: m[2], file: m[3], ext: m[4], contentType: EXT_TYPES[m[4]] };
}

export function newKey(kind: PhotoKeyKind, ownerId: string, contentType: string): string {
  const ext = IMAGE_TYPES[contentType];
  if (!ext) throw new Error("Unsupported image type");
  const id = randomBytes(12).toString("hex");
  const key = `${kind}/${ownerId}/${id}.${ext}`;
  if (!parseKey(key)) throw new Error("Bad key");
  return key;
}

export function storageMode(): "mock" | "s3" {
  if (process.env.MOCK_S3 === "true") return "mock";
  return process.env.S3_ENDPOINT && process.env.S3_BUCKET ? "s3" : "mock";
}

function mockDir(): string {
  return process.env.MOCK_S3_DIR || path.join(os.tmpdir(), "fenscloset-mock-s3");
}

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_PATH_STYLE !== "false",
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
    });
  }
  return client;
}
const bucket = () => process.env.S3_BUCKET ?? "";

function safeMockPath(key: string): string {
  if (!parseKey(key)) throw new Error("Bad key");
  return path.join(mockDir(), key);
}

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
  if (!parseKey(key)) throw new Error("Bad key");
  if (storageMode() === "mock") {
    const p = safeMockPath(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
    return;
  }
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
}

export class NotFoundError extends Error {
  constructor(key: string) {
    super(`Not found: ${key}`);
    this.name = "NotFoundError";
  }
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
  const parsed = parseKey(key);
  if (!parsed) throw new NotFoundError(key);
  if (storageMode() === "mock") {
    try {
      return { body: await readFile(safeMockPath(key)), contentType: parsed.contentType };
    } catch {
      throw new NotFoundError(key);
    }
  }
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return { body: Buffer.from(bytes), contentType: res.ContentType || parsed.contentType };
  } catch (e) {
    if ((e as { name?: string }).name === "NoSuchKey" || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) throw new NotFoundError(key);
    throw e;
  }
}

export async function objectExists(key: string): Promise<boolean> {
  if (!parseKey(key)) return false;
  if (storageMode() === "mock") {
    try { await stat(safeMockPath(key)); return true; } catch { return false; }
  }
  try { await getObject(key); return true; } catch { return false; }
}

export async function deleteObject(key: string): Promise<void> {
  if (!parseKey(key)) return;
  if (storageMode() === "mock") {
    await rm(safeMockPath(key), { force: true });
    return;
  }
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

// ---------- Uploads ----------

export type SignedUpload = { key: string; url: string; method: "PUT"; headers: Record<string, string>; expiresAt: number };

function uploadSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function uploadSig(key: string, contentType: string, exp: number): string {
  return createHmac("sha256", uploadSecret()).update(`${key}|${contentType}|${exp}`).digest("base64url");
}

/** Where the phone PUTs a photo. The key is scoped to the owner; the URL dies after `expiresInSec`. */
export async function signUpload(opts: { ownerId: string; kind?: PhotoKeyKind; contentType: string; expiresInSec?: number }): Promise<SignedUpload> {
  if (!IMAGE_TYPES[opts.contentType]) throw new Error("Unsupported image type");
  const key = newKey(opts.kind ?? "originals", opts.ownerId, opts.contentType);
  const exp = Math.floor(Date.now() / 1000) + (opts.expiresInSec ?? 600);
  if (storageMode() === "s3" && process.env.S3_DIRECT_UPLOADS === "true") {
    const url = await getSignedUrl(s3(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: opts.contentType }), { expiresIn: opts.expiresInSec ?? 600 });
    return { key, url, method: "PUT", headers: { "Content-Type": opts.contentType }, expiresAt: exp };
  }
  const sig = uploadSig(key, opts.contentType, exp);
  const url = `/api/uploads/put?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
  return { key, url, method: "PUT", headers: { "Content-Type": opts.contentType }, expiresAt: exp };
}

export function verifyUploadToken(key: string, contentType: string, exp: number, sig: string): boolean {
  if (!parseKey(key) || !IMAGE_TYPES[contentType] || !Number.isFinite(exp)) return false;
  if (exp * 1000 < Date.now()) return false;
  const expected = Buffer.from(uploadSig(key, contentType, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

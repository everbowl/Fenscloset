"use client";

/**
 * Browser-side upload queue. Picked photos go into IndexedDB first, as the raw files (review B B18): the shrink to
 * ≤1600px JPEG happens at upload time, one photo at a time, so backgrounding Safari halfway through a 150-photo pick
 * loses nothing and the main thread is never tied up for twenty seconds. On the next visit the queue picks up where
 * it stopped. Each photo is uploaded through the signed relay, then registered on its batch.
 */

export type PendingUpload = { id?: number; batchId: string; order: number; /** The picked file as is; shrunk when it is uploaded. */ blob: Blob; name: string };

const DB_NAME = "fenscloset";
const STORE = "pendingUploads";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    t.oncomplete = () => db.close();
  }));
}

export const pendingStore = {
  add: (p: PendingUpload) => tx<IDBValidKey>("readwrite", (s) => s.add(p)),
  /** Just the ids, in order: the loop never reads every photo's bytes to learn how many are left (review B B17). */
  keys: () => tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys()).then((ks) => ks.map(Number)),
  get: (id: number) => tx<PendingUpload | undefined>("readonly", (s) => s.get(id)),
  all: () => tx<PendingUpload[]>("readonly", (s) => s.getAll()),
  remove: (id: number) => tx<undefined>("readwrite", (s) => s.delete(id)),
  clear: () => tx<undefined>("readwrite", (s) => s.clear()),
};

/**
 * Shrinks a photo to ≤maxEdge on the long side and re-encodes as JPEG. Falls back to the original file.
 * The shrink happens in halving steps: one bilinear pass from a 4000px camera frame to 1600px skips
 * pixels and turns knit and weave textures into moiré ripples, which then lives on in every copy.
 */
export async function shrinkPhoto(file: Blob, maxEdge = 1600, quality = 0.88): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    let source: CanvasImageSource = bitmap;
    let sw = bitmap.width;
    let sh = bitmap.height;
    while (sw / 2 >= w && sh / 2 >= h) {
      const step = document.createElement("canvas");
      step.width = Math.round(sw / 2); step.height = Math.round(sh / 2);
      const sctx = step.getContext("2d");
      if (!sctx) throw new Error("no canvas");
      sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = "high";
      sctx.drawImage(source, 0, 0, sw, sh, 0, 0, step.width, step.height);
      source = step; sw = step.width; sh = step.height;
    }
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, sw, sh, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (!blob) throw new Error("encode failed");
    return blob;
  } catch {
    return file;
  }
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

/** A pick of `total` photos joins the open batch; a negative total takes failed picks back out of the count. */
export async function createBatch(total: number): Promise<{ batchId: string; startOrder: number; total: number }> {
  return json("/api/import/batches", { method: "POST", body: JSON.stringify({ total }) });
}

export const PUT_TIMEOUT_MS = 60_000;

/**
 * The signed PUT every photo upload in the app goes through (review B B15): a stalled cellular connection used to
 * hang "Uploading · 1 left" forever. Each try gets a minute; one more try after that; then a plain-words error.
 */
export async function putSigned(url: string, headers: Record<string, string>, body: Blob, tries = 2): Promise<void> {
  let lastError: Error = new Error("Upload failed.");
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const put = await fetch(url, { method: "PUT", headers, body, signal: AbortSignal.timeout(PUT_TIMEOUT_MS) });
      if (put.ok) return;
      if (put.status === 413) throw new Error("That photo is too big.");
      if (put.status === 403) throw new Error("That upload link is not valid any more. Try again.");
      lastError = new Error(`Upload failed (${put.status}).`);
      if (put.status < 500) break; // a 4xx will not change on a retry
    } catch (e) {
      const err = e as Error;
      if (err.name === "TimeoutError" || err.name === "AbortError") lastError = new Error("Upload timed out. Try again.");
      else if (/too big|not valid/.test(err.message)) throw err;
      else lastError = new Error(err.message || "Upload failed.");
    }
  }
  throw lastError;
}

/** The sign step for one photo: the key and where to PUT it. `kind` and `ownerId` scope the key (a minor's body photo). */
export async function signUploadFor(contentType: string, kind?: string, ownerId?: string): Promise<{ key: string; url: string; headers: Record<string, string> }> {
  return json("/api/uploads/sign", { method: "POST", body: JSON.stringify({ contentType, ...(kind ? { kind } : {}), ...(ownerId ? { ownerId } : {}) }) });
}

/** Shrink → sign → PUT → register. Throws with a plain-words message. */
export async function uploadOne(p: PendingUpload): Promise<{ entryId: string }> {
  const blob = await shrinkPhoto(p.blob);
  const contentType = blob.type || "image/jpeg";
  const signed = await signUploadFor(contentType);
  await putSigned(signed.url, signed.headers, blob);
  return json(`/api/import/batches/${p.batchId}/entries`, { method: "POST", body: JSON.stringify({ key: signed.key, order: p.order }) });
}

"use client";

/**
 * Browser-side upload queue. Picked photos go into IndexedDB first, so closing the tab mid-batch
 * loses nothing: on the next visit the queue picks up where it stopped. Each photo is resized on
 * the phone (≤1600px JPEG), uploaded through the signed relay, then registered on its batch.
 */

export type PendingUpload = { id?: number; batchId: string; order: number; blob: Blob; name: string };

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
  all: () => tx<PendingUpload[]>("readonly", (s) => s.getAll()),
  remove: (id: number) => tx<undefined>("readwrite", (s) => s.delete(id)),
  clear: () => tx<undefined>("readwrite", (s) => s.clear()),
};

/** Shrinks a photo to ≤maxEdge on the long side and re-encodes as JPEG. Falls back to the original file. */
export async function shrinkPhoto(file: File, maxEdge = 1600): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
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

export async function createBatch(total: number): Promise<{ batchId: string; startOrder: number; total: number }> {
  return json("/api/import/batches", { method: "POST", body: JSON.stringify({ total }) });
}

/** Sign → PUT → register. Throws with a plain-words message. */
export async function uploadOne(p: PendingUpload): Promise<{ entryId: string }> {
  const contentType = p.blob.type || "image/jpeg";
  const signed = await json<{ key: string; url: string; headers: Record<string, string> }>("/api/uploads/sign", { method: "POST", body: JSON.stringify({ contentType }) });
  const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: p.blob });
  if (!put.ok) throw new Error(put.status === 413 ? "That photo is too big." : "Upload failed.");
  return json(`/api/import/batches/${p.batchId}/entries`, { method: "POST", body: JSON.stringify({ key: signed.key, order: p.order }) });
}

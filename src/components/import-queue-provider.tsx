"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createBatch, pendingStore, uploadOne } from "@/lib/import/client-queue";
import type { BatchSummary } from "@/lib/import/service";

type UploadState = { pending: number; done: number; failed: { name: string; error: string }[]; active: boolean; /** Photos picked with no connection: added the moment it comes back. */ held: number };

type Ctx = {
  batch: BatchSummary | null;
  upload: UploadState;
  loaded: boolean;
  addFiles: (files: File[]) => Promise<void>;
  refresh: () => Promise<void>;
  retryFailedUploads: () => void;
  /** Forget the uploads that failed (a file the browser can't read, a photo too big): they leave the queue for good. */
  dropFailedUploads: () => Promise<void>;
  /** Try again now with the photos that were picked offline. */
  retryHeld: () => Promise<void>;
};

const QueueContext = createContext<Ctx | null>(null);
const UPLOAD_CONCURRENCY = 2;
const POLL_MS = 2500;

/** Lives in the root layout so uploads and polling keep going while the person moves between screens. It is the one poller (review B B20): screens read `batch` from here. */
export function ImportQueueProvider({ children }: { children: ReactNode }) {
  const [batch, setBatch] = useState<BatchSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [upload, setUpload] = useState<UploadState>({ pending: 0, done: 0, failed: [], active: false, held: 0 });
  const held = useRef<File[]>([]);
  const pumping = useRef(false);
  const failedIds = useRef(new Set<number>());
  const refreshing = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (refreshing.current) return refreshing.current; // one request in flight at a time
    refreshing.current = (async () => {
      try {
        const res = await fetch("/api/import/open", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (res.status === 401) { setBatch(null); return; }
        const body = (await res.json()) as { batch: BatchSummary | null };
        setBatch(body.batch);
      } catch { /* offline: keep what we have */ }
      finally { setLoaded(true); refreshing.current = null; }
    })();
    return refreshing.current;
  }, []);

  /**
   * A real pool of UPLOAD_CONCURRENCY (review B B19): each worker takes the next id, reads that one photo out of
   * IndexedDB (review B B17), shrinks it, uploads it, and moves on; a slow photo never holds the other slot.
   */
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const ids = (await pendingStore.keys()).filter((id) => !failedIds.current.has(id));
        if (!ids.length) break;
        let left = ids.length;
        let inFlight = 0;
        const show = () => setUpload((u) => ({ ...u, pending: left + inFlight, active: true }));
        show();
        const queue = [...ids];
        const worker = async () => {
          for (;;) {
            const id = queue.shift();
            if (id === undefined) return;
            left--; inFlight++; show();
            try {
              const p = await pendingStore.get(id);
              if (!p) continue; // removed meanwhile
              await uploadOne({ ...p, id });
              await pendingStore.remove(id);
              setUpload((u) => ({ ...u, done: u.done + 1 }));
            } catch (e) {
              failedIds.current.add(id);
              const p = await pendingStore.get(id).catch(() => undefined);
              setUpload((u) => ({ ...u, failed: [...u.failed, { name: p?.name ?? "Photo", error: (e as Error).message }] }));
            } finally { inFlight--; show(); void refresh(); }
          }
        };
        await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
      }
    } finally {
      pumping.current = false;
      setUpload((u) => ({ ...u, active: false, pending: 0 }));
      void refresh();
    }
  }, [refresh]);

  const addFiles = useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!images.length) return;
    let b: Awaited<ReturnType<typeof createBatch>>;
    try { b = await createBatch(images.length); }
    catch {
      // No connection (or the server is away): keep the photos and add them when it is back.
      held.current.push(...images);
      setUpload((u) => ({ ...u, held: held.current.length }));
      return;
    }
    setUpload((u) => ({ ...u, active: true, pending: u.pending + images.length }));
    // The raw files go in as they are (review B B18): fast, and nothing is lost if Safari is backgrounded now.
    for (const [i, f] of images.entries()) await pendingStore.add({ batchId: b.batchId, order: b.startOrder + i, blob: f, name: f.name });
    void pump();
    await refresh();
  }, [pump, refresh]);

  const retryFailedUploads = useCallback(() => {
    failedIds.current.clear();
    setUpload((u) => ({ ...u, failed: [] }));
    void pump();
  }, [pump]);
  const dropFailedUploads = useCallback(async () => {
    const ids = [...failedIds.current];
    for (const id of ids) await pendingStore.remove(id);
    failedIds.current.clear();
    setUpload((u) => ({ ...u, failed: [] }));
    // Those picks will never arrive: take them back out of the batch's count (review B B9).
    if (ids.length) await createBatch(-ids.length).catch(() => undefined);
    void refresh();
  }, [refresh]);
  const retryHeld = useCallback(async () => {
    const files = held.current.splice(0);
    setUpload((u) => ({ ...u, held: 0 }));
    if (files.length) await addFiles(files);
  }, [addFiles]);
  useEffect(() => {
    const onLine = () => { if (held.current.length) void retryHeld(); };
    window.addEventListener("online", onLine);
    return () => window.removeEventListener("online", onLine);
  }, [retryHeld]);

  // Resume anything left in IndexedDB and learn the open batch.
  useEffect(() => { void refresh(); void pump(); }, [refresh, pump]);

  // Poll while the server is still working on photos; not while the tab is in the background (review B G6), and once more the moment it comes back.
  const busy = Boolean(batch && (batch.counts.queued + batch.counts.uploaded + batch.counts.processing > 0)) || upload.active;
  useEffect(() => {
    if (!busy) return;
    const tick = () => { if (!document.hidden) void refresh(); };
    const t = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [busy, refresh]);

  const value = useMemo<Ctx>(() => ({ batch, upload, loaded, addFiles, refresh, retryFailedUploads, dropFailedUploads, retryHeld }), [batch, upload, loaded, addFiles, refresh, retryFailedUploads, dropFailedUploads, retryHeld]);
  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useImportQueue(): Ctx {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error("useImportQueue outside ImportQueueProvider");
  return ctx;
}

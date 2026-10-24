"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createBatch, pendingStore, shrinkPhoto, uploadOne, type PendingUpload } from "@/lib/import/client-queue";
import type { BatchSummary } from "@/lib/import/service";

type UploadState = { pending: number; done: number; failed: { name: string; error: string }[]; active: boolean };

type Ctx = {
  batch: BatchSummary | null;
  upload: UploadState;
  loaded: boolean;
  addFiles: (files: File[]) => Promise<void>;
  refresh: () => Promise<void>;
  retryFailedUploads: () => void;
};

const QueueContext = createContext<Ctx | null>(null);
const UPLOAD_CONCURRENCY = 2;

/** Lives in the root layout so uploads and polling keep going while the person moves between screens. */
export function ImportQueueProvider({ children }: { children: ReactNode }) {
  const [batch, setBatch] = useState<BatchSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [upload, setUpload] = useState<UploadState>({ pending: 0, done: 0, failed: [], active: false });
  const inFlight = useRef(0);
  const pumping = useRef(false);
  const failedIds = useRef(new Set<number>());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/import/open", { cache: "no-store" });
      if (res.status === 401) { setBatch(null); return; }
      const body = (await res.json()) as { batch: BatchSummary | null };
      setBatch(body.batch);
    } catch { /* offline: keep what we have */ }
    finally { setLoaded(true); }
  }, []);

  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const all = (await pendingStore.all()).filter((p) => !failedIds.current.has(p.id!));
        setUpload((u) => ({ ...u, pending: all.length + inFlight.current, active: all.length + inFlight.current > 0 }));
        if (!all.length) break;
        const slice = all.slice(0, UPLOAD_CONCURRENCY - inFlight.current);
        if (!slice.length) { await new Promise((r) => setTimeout(r, 200)); continue; }
        await Promise.all(slice.map(async (p) => {
          inFlight.current++;
          try {
            await uploadOne(p);
            await pendingStore.remove(p.id!);
            setUpload((u) => ({ ...u, done: u.done + 1 }));
          } catch (e) {
            failedIds.current.add(p.id!);
            setUpload((u) => ({ ...u, failed: [...u.failed, { name: p.name, error: (e as Error).message }] }));
          } finally { inFlight.current--; }
        }));
        void refresh();
      }
    } finally {
      pumping.current = false;
      setUpload((u) => ({ ...u, active: false, pending: 0 }));
      void refresh();
    }
  }, [refresh]);

  const addFiles = useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (!images.length) return;
    const b = await createBatch(images.length);
    setUpload((u) => ({ ...u, active: true, pending: u.pending + images.length }));
    for (const [i, f] of images.entries()) {
      const blob = await shrinkPhoto(f);
      const p: PendingUpload = { batchId: b.batchId, order: b.startOrder + i, blob, name: f.name };
      await pendingStore.add(p);
      if (i === 0) void pump();
    }
    void pump();
    await refresh();
  }, [pump, refresh]);

  const retryFailedUploads = useCallback(() => {
    failedIds.current.clear();
    setUpload((u) => ({ ...u, failed: [] }));
    void pump();
  }, [pump]);

  // Resume anything left in IndexedDB and learn the open batch.
  useEffect(() => { void refresh(); void pump(); }, [refresh, pump]);

  // Poll while the server is still working on photos.
  const busy = Boolean(batch && (batch.counts.queued + batch.counts.uploaded + batch.counts.processing > 0)) || upload.active;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void refresh(), 2500);
    return () => clearInterval(t);
  }, [busy, refresh]);

  const value = useMemo<Ctx>(() => ({ batch, upload, loaded, addFiles, refresh, retryFailedUploads }), [batch, upload, loaded, addFiles, refresh, retryFailedUploads]);
  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useImportQueue(): Ctx {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error("useImportQueue outside ImportQueueProvider");
  return ctx;
}

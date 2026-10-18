"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { useImportQueue } from "@/components/import-queue-provider";

const pad = (n: number) => String(n).padStart(3, "0");

function CameraIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
      <path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}

/**
 * Add clothes: pick a batch of hanger / flat-lay photos. Uploads and tagging run in the
 * background (and survive closing the app); the counter follows the mockup's `042 / 150` chip.
 */
export function AddScreen({ tips }: { tips?: ReactNode }) {
  const { batch, upload, loaded, addFiles, retryFailedUploads } = useImportQueue();
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await addFiles(files);
  }

  const inputs = (
    <>
      <input ref={pickRef} type="file" accept="image/*" multiple className="hidden" onChange={onPick} data-testid="pick-photos" />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} data-testid="take-photo" />
    </>
  );

  const c = batch?.counts;
  const working = c ? c.queued + c.uploaded + c.processing : 0;
  const ready = c?.needs_confirm ?? 0;
  const settled = c ? c.done + c.skipped : 0;
  const total = batch ? Math.max(batch.total, settled + ready + working + (c?.failed ?? 0)) : 0;
  const hasBatch = Boolean(batch) || upload.active || upload.pending > 0;
  const progress = total ? Math.round(((settled + ready) / total) * 100) : 0;

  if (!loaded) return <div><PageHeader title="Add" accent="clothes" /><div className="h-[380px] bg-bone" /></div>;

  if (!hasBatch) {
    return (
      <div>
        {inputs}
        <PageHeader title="Add" accent="clothes" />
        <p className="mono text-graphite">Hanger or flat-lay photos · one piece per photo</p>
        <button type="button" onClick={() => pickRef.current?.click()} className="mt-4 flex h-[380px] w-full flex-col items-center justify-center gap-3 bg-bone">
          <CameraIcon />
          <span className="mono mono-11">Pick photos from your camera roll</span>
          <span className="mono text-graphite">The app cuts the background and tags each piece</span>
        </button>
        <div className="mt-5 flex gap-2.5">
          <Button size="lg" className="flex-1" onClick={() => pickRef.current?.click()}>Pick photos</Button>
          <Button size="lg" variant="secondary" aria-label="Take a photo" className="w-[54px] px-0" onClick={() => cameraRef.current?.click()}><CameraIcon /></Button>
        </div>
        <p className="mono mt-4 text-center text-graphite">Then confirm each piece with one tap</p>
        <div className="mt-5 border-t border-ink pt-4" data-testid="add-from-store">
          <p className="mono text-graphite">Or add from a store</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Link href="/add/store?tab=link" className="mono flex h-[54px] items-center justify-center border border-ink text-[12px] uppercase tracking-[0.16em] text-ink" data-testid="add-by-link">By link</Link>
            <Link href="/add/store?tab=receipt" className="mono flex h-[54px] items-center justify-center border border-ink text-[12px] uppercase tracking-[0.16em] text-ink" data-testid="add-by-receipt">By receipt</Link>
          </div>
        </div>
        {tips}
      </div>
    );
  }

  return (
    <div>
      {inputs}
      <PageHeader title="Add" accent="clothes" aside={<span data-testid="batch-counter">{pad(settled + ready)} / {pad(total)}</span>} />
      <div className="relative h-[380px] bg-bone">
        <div className="absolute inset-x-0 top-0 flex h-14 items-center justify-between px-2">
          <span />
          <span className="mono mono-11 bg-paper px-2.5 py-1.5">{pad(settled + ready)} / {pad(total)}</span>
          <span />
        </div>
        <div className="flex h-full flex-col items-center justify-center gap-2.5 text-center">
          <span className="mono mono-11">{upload.pending > 0 ? `Uploading ${upload.pending} left` : working > 0 ? `Tagging ${working}` : ready > 0 ? `${ready} ready to confirm` : "All done"}</span>
          <span className="mono text-graphite">{ready > 0 ? `${ready} ready · ${working} tagging · ${settled} confirmed` : working > 0 ? "Keep this open or come back later" : "Nothing waiting"}</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/[0.12]"><div className="h-[3px] bg-ink transition-[width] duration-150" style={{ width: `${progress}%` }} /></div>
      </div>

      {upload.failed.length > 0 ? (
        <Banner tone="danger" title={`${upload.failed.length} photo${upload.failed.length > 1 ? "s" : ""} did not upload`} className="mt-4">
          <p className="text-[13px]">{upload.failed[0].error}</p>
          <button type="button" onClick={retryFailedUploads} className="mono mt-2 py-2">Try again</button>
        </Banner>
      ) : null}
      {batch && batch.failed.length > 0 ? (
        <Banner tone="danger" title={`${batch.failed.length} photo${batch.failed.length > 1 ? "s" : ""} could not be tagged`} className="mt-4">
          <p className="text-[13px]">{batch.failed[0].error ?? "Something went wrong."}</p>
          <RetryAll ids={batch.failed.map((f) => f.id)} />
        </Banner>
      ) : null}

      <div className="mt-5 flex gap-2.5">
        {batch && ready > 0 ? (
          <Link href={`/add/${batch.id}`} className="flex h-[54px] flex-1 items-center justify-center bg-ink font-mono text-[12px] uppercase tracking-[0.16em] text-paper">Confirm {ready} ready</Link>
        ) : (
          <Button size="lg" className="flex-1" disabled>{working > 0 || upload.active ? "Tagging…" : "Nothing to confirm"}</Button>
        )}
        <Button size="lg" variant="secondary" aria-label="Add more photos" className="w-[54px] px-0" onClick={() => pickRef.current?.click()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 4v16M4 12h16" /></svg>
        </Button>
      </div>
      <p className="mono mt-4 text-center text-graphite">Progress is saved · you can leave and come back</p>
      <div className="mt-5 border-t border-ink pt-4" data-testid="add-from-store">
          <p className="mono text-graphite">Or add from a store</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Link href="/add/store?tab=link" className="mono flex h-[54px] items-center justify-center border border-ink text-[12px] uppercase tracking-[0.16em] text-ink" data-testid="add-by-link">By link</Link>
            <Link href="/add/store?tab=receipt" className="mono flex h-[54px] items-center justify-center border border-ink text-[12px] uppercase tracking-[0.16em] text-ink" data-testid="add-by-receipt">By receipt</Link>
          </div>
        </div>
    </div>
  );
}

function RetryAll({ ids }: { ids: string[] }) {
  const { refresh } = useImportQueue();
  return (
    <button type="button" className="mono mt-2 py-2" onClick={async () => { await Promise.all(ids.map((id) => fetch(`/api/import/entries/${id}/process`, { method: "POST" }))); await refresh(); }}>
      Try again
    </button>
  );
}

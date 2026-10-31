"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button, buttonClass, Icons } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { useImportQueue } from "@/components/import-queue-provider";
import { LetThemGo } from "./let-them-go";

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
  const { batch, upload, loaded, addFiles, retryFailedUploads, dropFailedUploads, retryHeld } = useImportQueue();
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await addFiles(files);
  }
  // On a computer, photos can be dropped on the tile.
  const [over, setOver] = useState(false);
  const drop = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: async (e: React.DragEvent) => { e.preventDefault(); setOver(false); const files = Array.from(e.dataTransfer.files ?? []); if (files.length) await addFiles(files); },
  };

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
  const hasBatch = Boolean(batch) || upload.active || upload.pending > 0 || upload.held > 0;
  const progress = total ? Math.round(((settled + ready) / total) * 100) : 0;

  if (!loaded) return <div className="lg:max-w-[560px]"><PageHeader title="Add" accent="clothes" /><div className="h-[380px] bg-bone" /></div>;

  if (!hasBatch) {
    // Jeff, 31 Oct 2026 (I1): "From photos" opens the camera roll at once; the tips stay right here on the Add screen.
    return (
      <div className="lg:max-w-[560px]" {...drop}>
        {inputs}
        <PageHeader title="Add" accent="clothes" />
        <p className="mono text-graphite">How are you adding?</p>
        <div className={`mt-4 flex flex-col gap-4 ${over ? "outline outline-2 -outline-offset-4 outline-dashed outline-ink" : ""}`} data-testid="add-doors">
          <div className="flex items-stretch gap-2.5">
            <Button size="lg" className="flex-1 min-h-[72px] justify-start" icon={<Icons.camera />} sub="Hanger or flat-lay shots · one piece each" onClick={() => pickRef.current?.click()} data-testid="door-photo">From photos</Button>
            <button type="button" aria-label="Take a photo" className="flex w-[64px] shrink-0 items-center justify-center rounded-full border-2 border-ink bg-paper text-ink active:bg-bone lg:hidden" onClick={() => cameraRef.current?.click()}><CameraIcon /></button>
          </div>
          <Link href="/add/store?tab=link" className="flex min-h-[64px] w-full items-center justify-between border border-ink px-5 text-left" data-testid="add-by-link">
            <span><span className="mono block text-[12px] uppercase tracking-[0.16em]">From a store link</span><span className="mono mt-1 block text-[11px] text-graphite">Paste the product page · pick color, size, how many</span></span>
            <span className="mono">→</span>
          </Link>
          <Link href="/add/store?tab=receipt" className="flex min-h-[64px] w-full items-center justify-between border border-ink px-5 text-left" data-testid="add-by-receipt">
            <span><span className="mono block text-[12px] uppercase tracking-[0.16em]">From a receipt</span><span className="mono mt-1 block text-[11px] text-graphite">A photo of the receipt · the store's own product photos</span></span>
            <span className="mono">→</span>
          </Link>
        </div>
        <p className="mono mt-4 text-center text-graphite">Then confirm each piece with one tap</p>
        {tips}
      </div>
    );
  }

  return (
    <div className="lg:max-w-[560px]">
      {inputs}
      <PageHeader title="Add" accent="clothes" aside={<span data-testid="batch-counter">{pad(settled + ready)} / {pad(total)}</span>} />
      <div {...drop} className={`relative h-[300px] bg-bone ${over ? "outline outline-2 -outline-offset-4 outline-dashed outline-ink" : ""}`}>
        <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
          <span className="mono mono-11" aria-live="polite">{upload.pending > 0 ? `Uploading · ${upload.pending} left` : working > 0 ? `Tagging · ${working} left` : ready > 0 ? `${ready} ready to confirm` : "All done"}</span>
          <span className="mono text-graphite">{ready > 0 && working > 0 ? `${working} still tagging · start confirming` : working > 0 || upload.pending > 0 ? "Keep this open or come back later" : ready > 0 ? "One tap each" : "Nothing waiting"}</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/[0.12]"><div className="h-[3px] bg-ink transition-[width] duration-150" style={{ width: `${progress}%` }} /></div>
      </div>

      {upload.held > 0 ? (
        <Banner tone="danger" title={`No connection · ${upload.held} photo${upload.held > 1 ? "s" : ""} waiting`} className="mt-4" data-testid="held-banner">
          <p className="text-[13px]">They’ll be added the moment you’re back online.</p>
          <button type="button" onClick={() => void retryHeld()} className="pill mt-3">Try now</button>
        </Banner>
      ) : null}
      {upload.failed.length > 0 ? (
        <Banner tone="danger" title={`${upload.failed.length} photo${upload.failed.length > 1 ? "s" : ""} did not upload`} className="mt-4">
          <p className="text-[13px]">{plainError(upload.failed[0].error)}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={retryFailedUploads} className="pill">Try again</button>
            <button type="button" onClick={() => void dropFailedUploads()} className="pill pill-quiet" data-testid="drop-failed">Remove these</button>
          </div>
        </Banner>
      ) : null}
      {batch && batch.failed.length > 0 ? (
        <Banner tone="danger" title={`${batch.failed.length} photo${batch.failed.length > 1 ? "s" : ""} could not be tagged`} className="mt-4">
          <p className="text-[13px]">{plainError(batch.failed[0].error)}</p>
          <div className="mt-3 flex gap-2">
            <RetryAll ids={batch.failed.map((f) => f.id)} />
            {ready === 0 && working === 0 && !upload.active ? <LetThemGoHere batchId={batch.id} count={batch.failed.length} /> : null}
          </div>
        </Banner>
      ) : null}

      <div className="mt-5 flex items-center gap-2.5">
        {batch && ready > 0 ? (
          <Link href={`/add/${batch.id}`} className={buttonClass({ size: "lg", className: "flex-1" })} data-testid="confirm-ready"><Icons.check /><span className="flex flex-col items-start gap-0.5 text-left"><span>Confirm {ready} ready</span><span className="mono text-[11px] tracking-[0.12em]">One tap each</span></span></Link>
        ) : (
          <Button size="lg" className="flex-1" busy={working > 0 || upload.active} disabled>{working > 0 || upload.active ? "Tagging…" : "Nothing to confirm"}</Button>
        )}
        <button type="button" aria-label="Add more photos" className="flex size-[60px] shrink-0 items-center justify-center rounded-full border-2 border-ink bg-paper text-ink active:bg-bone" onClick={() => pickRef.current?.click()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 4v16M4 12h16" /></svg>
        </button>
        <button type="button" aria-label="Take a photo" className="flex size-[60px] shrink-0 items-center justify-center rounded-full border-2 border-ink bg-paper text-ink active:bg-bone lg:hidden" onClick={() => cameraRef.current?.click()}><CameraIcon /></button>
      </div>
      <p className="mono mt-4 text-center text-graphite">Progress is saved · you can leave and come back</p>
      <div className="mt-5 border-t border-ink pt-4" data-testid="add-from-store">
          <p className="mono text-graphite">Or add from a store</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Link href="/add/store?tab=link" className="pill h-[54px] w-full" data-testid="add-by-link">By link</Link>
            <Link href="/add/store?tab=receipt" className="pill h-[54px] w-full" data-testid="add-by-receipt">By receipt</Link>
          </div>
        </div>
    </div>
  );
}

function RetryAll({ ids }: { ids: string[] }) {
  const { refresh } = useImportQueue();
  return (
    <button type="button" className="pill" onClick={async () => { await Promise.all(ids.map((id) => fetch(`/api/import/entries/${id}/process`, { method: "POST" }))); await refresh(); }}>
      Try again
    </button>
  );
}

/** Only failed photos are left in the batch: let them go (after asking) and the pile is clear. */
function LetThemGoHere({ batchId, count }: { batchId: string; count: number }) {
  const { refresh } = useImportQueue();
  return <LetThemGo batchId={batchId} count={count} onDone={() => refresh()} />;
}

/** Raw errors stay in the log; the family reads plain words. */
export function plainError(raw: string | null | undefined): string {
  const e = (raw ?? "").toLowerCase();
  if (!e) return "Something went wrong.";
  if (e.includes("unsupported image") || e.includes("heic") || e.includes("decode")) return "This photo is in a format the app can’t read. A screenshot of it works.";
  if (e.includes("413") || e.includes("too large") || e.includes("entity too large")) return "This photo is too big to upload.";
  if (e.includes("api_key") || e.includes("api key") || e.includes("not configured")) return "Tagging isn’t set up on the site yet. Jeff has been told.";
  if (e.includes("failed to fetch") || e.includes("network") || e.includes("load failed")) return "The connection dropped. It will try again.";
  if (/\b5\d\d\b/.test(e)) return "The site hiccuped. Try again in a moment.";
  return "Something went wrong. Try again in a moment.";
}

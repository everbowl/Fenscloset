"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button, Icons } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { useImportQueue } from "@/components/import-queue-provider";
import { abandonBatchAction } from "@/app/(flow)/add/[batchId]/actions";

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
  /** Linear (Jeff, 18 Oct 2026): first pick the door, then the photo panel opens. */
  const [door, setDoor] = useState<"photo" | null>(null);

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
  const hasBatch = Boolean(batch) || upload.active || upload.pending > 0 || upload.held > 0;
  const progress = total ? Math.round(((settled + ready) / total) * 100) : 0;

  if (!loaded) return <div><PageHeader title="Add" accent="clothes" /><div className="h-[380px] bg-bone" /></div>;

  if (!hasBatch) {
    if (door !== "photo") {
      return (
        <div>
          {inputs}
          <PageHeader title="Add" accent="clothes" />
          <p className="mono text-graphite">How are you adding?</p>
          <div className="mt-4 flex flex-col gap-4" data-testid="add-doors">
            <Button size="lg" className="w-full min-h-[72px] justify-start" icon={<Icons.camera />} sub="Hanger or flat-lay shots · one piece each" onClick={() => setDoor("photo")} data-testid="door-photo">From photos</Button>
            <Link href="/add/store?tab=link" className="flex min-h-[64px] w-full items-center justify-between border border-ink px-5 text-left" data-testid="add-by-link">
              <span><span className="mono block text-[12px] uppercase tracking-[0.16em]">From a store link</span><span className="mono mt-1 block text-[11px] text-graphite">Paste the product page · pick color, size, how many</span></span>
              <span className="mono">→</span>
            </Link>
            <Link href="/add/store?tab=receipt" className="flex min-h-[64px] w-full items-center justify-between border border-ink px-5 text-left" data-testid="add-by-receipt">
              <span><span className="mono block text-[12px] uppercase tracking-[0.16em]">From a receipt</span><span className="mono mt-1 block text-[11px] text-graphite">A photo of the receipt · the store's own product photos</span></span>
              <span className="mono">→</span>
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div>
        {inputs}
        <PageHeader title="Add" accent="clothes" aside={<button type="button" onClick={() => setDoor(null)} className="pill pill-sm" data-testid="door-back">Other ways</button>} />
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
            {ready === 0 && working === 0 && !upload.active ? <LetThemGo batchId={batch.id} /> : null}
          </div>
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

/** Only failed photos are left in the batch: let them go and the pile is clear. */
function LetThemGo({ batchId }: { batchId: string }) {
  const { refresh } = useImportQueue();
  return (
    <button type="button" className="pill pill-quiet" data-testid="let-them-go" onClick={async () => { await abandonBatchAction(batchId); await refresh(); }}>
      Let them go
    </button>
  );
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

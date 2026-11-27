"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button, buttonClass, Icons } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { toast } from "@/components/ui/toast";
import { useImportQueue } from "@/components/import-queue-provider";
import { useNow } from "@/components/items/use-now";
import { isTakingLong } from "@/lib/import/timing";
import { skipEntryAction } from "@/app/(flow)/add/[batchId]/actions";
import type { BatchSummary, EntryRow } from "@/lib/import/service";
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
 * Add clothes: pick a batch of hanger / flat-lay photos. Uploads and tagging run in the background (and survive
 * closing the app). The three doors show at once (review B F1); the batch view takes over only while a batch has
 * something in it, with one row per photo saying where it is (uploading, tagging, ready, failed · try again).
 */
export function AddScreen({ tips }: { tips?: ReactNode }) {
  const { batch, upload, addFiles, retryFailedUploads, dropFailedUploads, retryHeld } = useImportQueue();
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
  const failed = c?.failed ?? 0;
  const settled = c ? c.done + c.skipped : 0;
  // A batch with nothing live in it (every pick failed and was removed, review B B9) is no batch: the doors come back.
  const live = working + ready + failed > 0;
  const total = batch ? Math.max(batch.total, settled + ready + working + failed) : 0;
  const hasBatch = (Boolean(batch) && live) || upload.active || upload.pending > 0 || upload.held > 0;
  const progress = total ? Math.round(((settled + ready) / total) * 100) : 0;

  if (!hasBatch) {
    // Three ways in (Alta's "Add to closet" sheet, docs/redesign-2026-11-23.md): photos first and colored, the store link and the receipt as quiet cards.
    return (
      <div className="lg:max-w-[560px]" {...drop}>
        {inputs}
        <PageHeader title="Add clothes" />
        <div className={`flex flex-col gap-2.5 ${over ? "outline outline-2 -outline-offset-4 outline-dashed outline-ink rounded-2xl" : ""}`} data-testid="add-doors">
          <div className="flex items-stretch gap-2">
            <Button size="lg" className="min-h-[64px] flex-1 justify-start" icon={<Icons.camera />} sub="Hanger or flat-lay shots, one piece each" onClick={() => pickRef.current?.click()} data-testid="door-photo">Add with photos</Button>
            <button type="button" aria-label="Take a photo" className="flex w-16 shrink-0 items-center justify-center rounded-full bg-bone text-ink active:bg-[#e2e1dc] lg:hidden" onClick={() => cameraRef.current?.click()}><CameraIcon /></button>
          </div>
          <Link href="/add/store?tab=link" className="card tap flex min-h-[64px] w-full items-center justify-between gap-3 px-4 py-3 text-left" data-testid="add-by-link">
            <span><span className="block text-[16px] font-semibold">Paste a store link</span><span className="note mt-0.5 block">The product page. Say how many in each color and size.</span></span>
            <span className="text-graphite">›</span>
          </Link>
          <Link href="/add/store?tab=receipt" className="card tap flex min-h-[64px] w-full items-center justify-between gap-3 px-4 py-3 text-left" data-testid="add-by-receipt">
            <span><span className="block text-[16px] font-semibold">Forward a receipt</span><span className="note mt-0.5 block">Receipts or order emails, as many as you like. The stores’ own photos.</span></span>
            <span className="text-graphite">›</span>
          </Link>
        </div>
        <p className="caption mt-4 text-center">Then review each piece with one tap.</p>
        {tips}
      </div>
    );
  }

  const stageLine = upload.pending > 0 ? `Uploading · ${upload.pending} left` : working > 0 ? `Tagging · ${working} left` : ready > 0 ? `${ready} ready to review` : failed > 0 ? `${failed} could not be tagged` : "All done";
  return (
    <div className="lg:max-w-[560px]">
      {inputs}
      <PageHeader title="Add clothes" aside={<span data-testid="batch-counter">{pad(settled + ready)} / {pad(total)}</span>} />
      <div {...drop} className={`stage relative overflow-hidden ${over ? "outline outline-2 -outline-offset-4 outline-dashed outline-ink" : ""}`}>
        <div className="flex min-h-[132px] flex-col items-center justify-center gap-2 px-6 py-6 text-center">
          {working > 0 || upload.active ? <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-ink" /> : null}
          <span className="text-[18px] font-semibold" aria-live="polite">{stageLine}</span>
          <span className="note">{ready > 0 && working > 0 ? `${working} still tagging. Start reviewing.` : working > 0 || upload.pending > 0 ? "Keep this open or come back later; progress is saved." : ready > 0 ? "One tap each." : failed > 0 ? "Try them again, or let them go." : "Nothing waiting."}</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/[0.08]"><div className="h-1 bg-ink transition-[width] duration-150" style={{ width: `${progress}%` }} /></div>
      </div>

      {upload.held > 0 ? (
        <Banner tone="danger" title={`No connection · ${upload.held} photo${upload.held > 1 ? "s" : ""} waiting`} className="mt-4" data-testid="held-banner">
          <p className="text-[14px]">They’ll be added the moment you’re back online.</p>
          <button type="button" onClick={() => void retryHeld()} className="pill mt-3">Try now</button>
        </Banner>
      ) : null}
      {upload.failed.length > 0 ? (
        <Banner tone="danger" title={`${upload.failed.length} photo${upload.failed.length > 1 ? "s" : ""} did not upload`} className="mt-4">
          <p className="text-[14px]">{plainError(upload.failed[0].error)}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={retryFailedUploads} className="pill">Try again</button>
            <button type="button" onClick={() => void dropFailedUploads()} className="pill pill-quiet" data-testid="drop-failed">Remove these</button>
          </div>
        </Banner>
      ) : null}
      {batch && batch.failed.length > 1 ? (
        <Banner tone="danger" title={`${batch.failed.length} photos could not be tagged`} className="mt-4">
          <p className="text-[14px]">{plainError(batch.failed[0].error)}</p>
          <div className="mt-3 flex gap-2">
            <RetryAll ids={batch.failed.map((f) => f.id)} />
            {ready === 0 && working === 0 && !upload.active ? <LetThemGoHere batchId={batch.id} count={batch.failed.length} /> : null}
          </div>
        </Banner>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        {batch && ready > 0 ? (
          <Link href={`/add/${batch.id}`} className={buttonClass({ size: "lg", className: "flex-1" })} data-testid="confirm-ready"><Icons.check /><span className="flex flex-col items-start text-left"><span>Confirm {ready} ready</span><span className="text-[13px] font-medium opacity-75">One tap each</span></span></Link>
        ) : (
          <Button size="lg" className="flex-1" busy={working > 0 || upload.active} disabled>{working > 0 || upload.active ? "Tagging…" : "Nothing to review"}</Button>
        )}
        <button type="button" aria-label="Add more photos" className="flex size-[54px] shrink-0 items-center justify-center rounded-full bg-bone text-ink active:bg-[#e2e1dc]" onClick={() => pickRef.current?.click()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M12 4v16M4 12h16" /></svg>
        </button>
        <button type="button" aria-label="Take a photo" className="flex size-[54px] shrink-0 items-center justify-center rounded-full bg-bone text-ink active:bg-[#e2e1dc] lg:hidden" onClick={() => cameraRef.current?.click()}><CameraIcon /></button>
      </div>

      <BatchRows batch={batch} uploading={upload.pending} />

      <div className="mt-5" data-testid="add-from-store">
        <p className="caption">Or add from a store</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Link href="/add/store?tab=link" className="pill h-12 w-full text-[15px]" data-testid="add-by-link">Paste a link</Link>
          <Link href="/add/store?tab=receipt" className="pill h-12 w-full text-[15px]" data-testid="add-by-receipt">Forward a receipt</Link>
        </div>
      </div>
    </div>
  );
}

/** One row per photo (the v2 Add flow): the small picture, where it is, and the one thing to do about it when something is wrong. */
function BatchRows({ batch, uploading }: { batch: BatchSummary | null; uploading: number }) {
  const rows = batch?.rows ?? [];
  if (!rows.length && !uploading) return null;
  const shownUploading = Math.min(uploading, 3);
  return (
    <ul className="mt-4 flex flex-col divide-y divide-line" data-testid="batch-rows">
      {Array.from({ length: shownUploading }, (_, i) => (
        <li key={`up-${i}`} className="flex items-center gap-3 py-2.5" data-testid="row-uploading">
          <span className="stage size-12 shrink-0 animate-pulse rounded-xl" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-medium">Photo</span><span className="caption">Uploading</span></span>
        </li>
      ))}
      {uploading > shownUploading ? <li className="caption py-2.5">and {uploading - shownUploading} more uploading</li> : null}
      {batch ? rows.map((r) => <Row key={r.id} row={r} batchId={batch.id} />) : null}
    </ul>
  );
}

function Row({ row, batchId }: { row: EntryRow; batchId: string }) {
  const { refresh } = useImportQueue();
  const now = useNow();
  const [busy, setBusy] = useState<"retry" | "remove" | null>(null);
  const tagging = row.status === "queued" || row.status === "uploaded" || row.status === "processing";
  const late = tagging && isTakingLong(row.since, now);
  const retry = async () => {
    setBusy("retry");
    const ok = await retryEntries([row.id]);
    setBusy(null);
    if (ok) void refresh();
  };
  const remove = async () => {
    setBusy("remove");
    const r = await skipEntryAction(batchId, row.id);
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    void refresh();
  };
  const word = row.status === "failed" ? plainError(row.error) : row.status === "needs_confirm" ? "Ready to review" : late ? "Taking long" : row.status === "processing" ? "Tagging" : "Waiting to tag";
  return (
    <li className="flex items-center gap-3 py-2.5" data-testid={`row-${row.status}`}>
      <span className={`stage relative size-12 shrink-0 overflow-hidden rounded-xl ${tagging && !late ? "animate-pulse" : ""}`}>
        <img src={`/api/photo/${row.photoKey}`} alt="" className="size-full object-contain" loading="lazy" decoding="async" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{row.name ?? "Photo"}</span>
        <span className="caption block truncate" aria-live={late ? "polite" : undefined}>{word}</span>
      </span>
      {row.status === "needs_confirm" ? <Link href={`/add/${batchId}?entry=${row.id}`} className="pill pill-sm shrink-0" data-testid="row-review">Review</Link> : null}
      {row.status === "failed" || late ? (
        <span className="flex shrink-0 gap-1.5">
          <button type="button" onClick={retry} disabled={busy !== null} className="pill pill-sm" data-testid="row-retry">{busy === "retry" ? "Trying…" : "Try again"}</button>
          {row.status === "failed" ? <button type="button" onClick={remove} disabled={busy !== null} className="pill pill-sm pill-quiet" data-testid="row-remove">{busy === "remove" ? "Removing…" : "Remove"}</button> : null}
        </span>
      ) : null}
    </li>
  );
}

/** Try again for a set of entries; says so when any of them refused (review B F7). True when every one was re-queued. */
export async function retryEntries(ids: string[]): Promise<boolean> {
  const results = await Promise.all(ids.map((id) => fetch(`/api/import/entries/${id}/process`, { method: "POST" }).then((r) => r.ok).catch(() => false)));
  const bad = results.filter((ok) => !ok).length;
  if (bad) toast.error(bad === ids.length ? "Couldn’t try again. Give it a moment." : `${bad} of ${ids.length} couldn’t be tried again. Give it a moment.`);
  return bad === 0;
}

function RetryAll({ ids }: { ids: string[] }) {
  const { refresh } = useImportQueue();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="pill" disabled={busy} onClick={async () => { setBusy(true); const ok = await retryEntries(ids); setBusy(false); if (ok) await refresh(); }}>
      {busy ? "Trying…" : "Try again"}
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
  // A HEIC that reached the server is refused at the sign step with "Use a JPEG, PNG or WebP photo." (review B B16): retrying cannot help, a screenshot can.
  if (e.includes("unsupported image") || e.includes("heic") || e.includes("heif") || e.includes("decode") || e.includes("jpeg, png or webp")) return "This photo is in a format the app can’t read. A screenshot of it works.";
  if (e.includes("413") || e.includes("too large") || e.includes("too big") || e.includes("entity too large")) return "This photo is too big to upload.";
  if (e.includes("timed out") || e.includes("took too long")) return "That took too long. Try again.";
  if (e.includes("api_key") || e.includes("api key") || e.includes("not configured") || e.includes("not set up")) return "Tagging isn’t set up on the site yet. the owner has been told.";
  if (e.includes("failed to fetch") || e.includes("network") || e.includes("load failed")) return "The connection dropped. It will try again.";
  if (e.includes("could not add it on its own")) return raw!.replace(/^Could not add it on its own: /i, "Couldn’t add it on its own: ");
  if (/\b5\d\d\b/.test(e)) return "The site hiccuped. Try again in a moment.";
  return "Something went wrong. Try again in a moment.";
}

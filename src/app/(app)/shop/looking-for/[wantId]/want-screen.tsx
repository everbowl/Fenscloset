"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { UndoStrip, useUndoable } from "@/components/ui/undo-strip";
import { AddToLook } from "@/components/looks/add-to-look";
import { cn } from "@/lib/cn";
import type { WantView } from "@/lib/shop/wants";
import { deleteWantAction, editWantAction, foundWantAction, searchWantAction } from "../actions";
import { WantSheet } from "../want-sheet";
import { useRefreshWhile, useWantSearch } from "../use-want-search";
import { ago } from "../ago";

/** One want: what was asked, the matches with the new ones marked, and the four things to do with it. */
export function WantScreen({ meId, want }: { meId: string; want: WantView }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<"found" | "delete" | null>(null);
  const [edit, setEdit] = useState(false);
  const { searching, error, setError, run, secondsOf } = useWantSearch();
  const s = searching[want.id];
  // Its first search was started elsewhere: keep asking while it runs, for a minute at most; a line that was checked (even
  // one that failed) is never "searching" (review E C3), so the buttons stay live and the person can try again.
  const firstSearch = !want.lastSearchedAt && !want.foundAt;
  const waiting = useRefreshWhile(firstSearch && !s);
  const running = Boolean(s) || (firstSearch && waiting);
  const stores = new Set(want.matches.map((m) => m.storeName)).size;
  const fresh = want.matches.filter((m) => m.isNew).length;
  // A search started here just finished: say what it brought back, for a few seconds.
  const [justSearched, setJustSearched] = useState(false);
  const wasSearching = useRef(false);
  useEffect(() => {
    if (wasSearching.current && !s) { setJustSearched(true); const t = setTimeout(() => setJustSearched(false), 8000); wasSearching.current = false; return () => clearTimeout(t); }
    wasSearching.current = Boolean(s);
  }, [s]);
  const undoable = useUndoable(); // Remove: the strip for five seconds, then it really goes (Q1)
  const meta = [want.category ?? null, want.maxPrice ? `under $${want.maxPrice.toLocaleString("en-US")}` : null, `for ${want.forPersonId === meId ? "me" : want.forName}`].filter(Boolean).join(" · ");

  function act(kind: "found" | "delete", fn: () => Promise<{ ok: true } | { ok: false; error: string }>, then: () => void) {
    setError(undefined); setBusy(kind);
    start(async () => { const r = await fn(); setBusy(null); if (!r.ok) setError(r.error); else then(); });
  }

  /** The line under the title: searching, just searched, found, failed, or when the stores were last checked. */
  const status = (): { text: string; strong: boolean } => {
    if (justSearched) return { text: fresh ? `✓ ${fresh} new` : want.lastError ? want.lastError : "Nothing new since last time", strong: true };
    if (want.foundAt) return { text: `Found ${ago(want.foundAt)}`, strong: false };
    if (want.lastError) return { text: `${want.lastError} Last tried ${ago(want.lastSearchedAt)}.`, strong: true };
    if (!want.lastSearchedAt) return { text: "Not checked yet. Tap Search now.", strong: true };
    return { text: `Stores checked ${ago(want.lastSearchedAt)} · again every day`, strong: false };
  };

  return (
    <div data-testid="want" className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-14">
      <div className="lg:col-span-2">
        <PageHeader eyebrow={<span className="text-ink">Looking for</span>} title={want.foundAt ? "Found" : "Still"} accent={want.foundAt ? "it" : "looking"} />
      </div>
      {error ? <Banner tone="danger" title={error} className="mb-3 lg:col-span-2" /> : null}

      <div className="card p-4 lg:col-start-2 lg:row-start-3">
        <p className="section" data-testid="want-title">{want.text}</p>
        <p className="caption mt-1.5">{meta}</p>
        {want.queries.length ? <p className="note mt-1">Searching for: {want.queries.join(" · ")}</p> : null}
        {running ? (
          <div className="mt-4" data-testid="want-thinking" aria-live="polite">
            <p className="flex items-center justify-between gap-3 text-[15px] font-medium"><span>{s?.step ?? "Searching the stores…"}</span>{s ? <span className="caption shrink-0" aria-hidden>{secondsOf(s)}s</span> : null}</p>
            <p className="note mt-1">Usually 5 to 20 seconds. You can leave; the matches are kept here.</p>
          </div>
        ) : (
          <p className={cn("note mt-4", status().strong && "text-ink")} data-testid="want-checked" role={justSearched || want.lastError ? "status" : undefined} suppressHydrationWarning>{status().text}</p>
        )}
        {undoable.pending ? <UndoStrip text={`${undoable.pending.text} · ${want.text}`} onUndo={undoable.undo} testId="want-undo" className="mt-4" /> : null}
        <div className={cn("mt-4 flex flex-wrap gap-2", undoable.pending && "hidden")}>
          {want.foundAt ? (
            <button type="button" disabled={busy !== null} onClick={() => act("found", () => foundWantAction(want.id, false), () => router.refresh())} className="pill pill-solid" data-testid="want-unfound">Put it back on the list</button>
          ) : (
            <>
              <button type="button" disabled={running} onClick={() => void run(want.id, () => searchWantAction(want.id))} className={cn("pill", want.lastError && "pill-solid")} data-testid="want-search-now">Search now</button>
              <button type="button" disabled={running} onClick={() => setEdit(true)} className="pill" data-testid="want-edit">Edit</button>
              <button type="button" disabled={busy !== null || running} onClick={() => act("found", () => foundWantAction(want.id, true), () => router.refresh())} className={cn("pill", !want.lastError && "pill-solid")} data-testid="want-found">Found it</button>
            </>
          )}
          <button type="button" disabled={busy !== null} onClick={() => undoable.start("Taken off the list", () => act("delete", () => deleteWantAction(want.id), () => router.push(`/shop/looking-for?for=${want.forPersonId}`)))} className="pill pill-quiet" data-testid="want-delete">Remove</button>
        </div>
      </div>

      <section className="mt-6 lg:col-start-1 lg:row-start-3 lg:row-span-3 lg:mt-0" data-testid="want-matches">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="section">{want.matches.length ? `${want.matches.length} ${want.matches.length === 1 ? "match" : "matches"} from ${stores} ${stores === 1 ? "store" : "stores"}` : "Matches"}</h2>
          {fresh ? <p className="caption text-ink" data-testid="want-fresh">{fresh} new since you last looked</p> : null}
        </div>
        {want.matches.length ? (
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3">
            {want.matches.map((p) => (
              <div key={p.url} className={cn("min-w-0", p.isNew && "relative")} data-testid="want-match" data-new={p.isNew ? "1" : undefined}>
                <a href={p.url} target="_blank" rel="noreferrer" className="stage block h-[200px] overflow-hidden" aria-label={p.title}>
                  {p.imageUrl ? <img src={p.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" /> : null}
                </a>
                {p.isNew ? <span className="mono absolute left-2 top-2 rounded-full bg-ink px-2 py-0.5 text-paper">New</span> : null}
                <p className="mt-2 line-clamp-2 text-[14px] font-medium leading-snug">{p.title}</p>
                <p className="mono mt-0.5 text-graphite">{[p.priceText, p.storeName].filter(Boolean).join(" · ")}</p>
                <div className="mt-2 flex flex-col gap-1.5">
                  <a href={p.url} target="_blank" rel="noreferrer" className="pill pill-sm w-full" aria-label={`Buy ${p.title} at ${p.storeName}`}>Buy ↗</a>
                  <button type="button" onClick={() => router.push(`/shop?for=${want.forPersonId}&link=${encodeURIComponent(p.url)}`)} className="pill pill-sm pill-solid w-full" data-testid="want-judge">Judge it</button>
                  <AddToLook personId={want.forPersonId} piece={{ title: p.title, url: p.url, storeName: p.storeName, priceText: p.priceText, imageUrl: p.imageUrl, category: want.category }} testId="want-add-look" />
                </div>
              </div>
            ))}
          </div>
        ) : !running ? (
          <p className="note mt-4" data-testid="want-none">{want.lastError ? "Nothing found yet because the stores didn't answer. Search now tries again." : <>Nothing in the stores for this yet{want.maxPrice ? ` under $${want.maxPrice.toLocaleString("en-US")}` : ""}. The Shop keeps checking every day; tap Edit to widen the search.</>}</p>
        ) : null}
        {want.matches.length ? <p className="note mt-4">Judge it: the Shop says buy it, maybe or skip it, and can show it on you.</p> : null}
      </section>

      <WantSheet open={edit} onClose={() => setEdit(false)} title="Change it" value={want.text} onSave={(text) => void run(want.id, () => editWantAction(want.id, text))} />
    </div>
  );
}

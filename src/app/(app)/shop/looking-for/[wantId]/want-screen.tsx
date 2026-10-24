"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
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
  const running = Boolean(s) || (!want.lastSearchedAt && !want.foundAt);
  useRefreshWhile(running && !s); // its first search was started elsewhere: keep asking until it is done
  const stores = new Set(want.matches.map((m) => m.storeName)).size;
  const fresh = want.matches.filter((m) => m.isNew).length;
  const meta = [want.category ?? null, want.maxPrice ? `under $${want.maxPrice}` : null, `for ${want.forPersonId === meId ? "me" : want.forName}`].filter(Boolean).join(" · ");

  function act(kind: "found" | "delete", fn: () => Promise<{ ok: true } | { ok: false; error: string }>, then: () => void) {
    setError(undefined); setBusy(kind);
    start(async () => { const r = await fn(); setBusy(null); if (!r.ok) setError(r.error); else then(); });
  }

  return (
    <div data-testid="want" className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-14">
      <div className="lg:col-span-2">
        <PageHeader eyebrow={<Link href={`/shop/looking-for?for=${want.forPersonId}`} className="mono text-ink" data-testid="want-back">← Looking for</Link>} title={want.foundAt ? "Found" : "Still"} accent={want.foundAt ? "it" : "looking"} />
      </div>
      {error ? <Banner tone="danger" title={error} className="mb-3 lg:col-span-2" /> : null}

      <div className="lg:col-start-2 lg:row-start-3">
        <p className="serif text-[26px] leading-[1.15]" data-testid="want-title">{want.text}</p>
        <p className="mono mt-1.5 text-graphite">{meta}</p>
        {want.queries.length ? <p className="mono mt-1 text-graphite">Searching for: {want.queries.join(" · ")}</p> : null}
        {running ? (
          <div className="mt-4" data-testid="want-thinking" aria-live="polite">
            <p className="mono flex items-center justify-between gap-3 text-ink"><span>{s?.step ?? "Searching the stores…"}</span><span className="shrink-0 text-graphite">{s ? secondsOf(s) : 0}s</span></p>
            <p className="mono mt-1 text-graphite">Usually 5 to 20 seconds. You can leave; the matches are kept here.</p>
          </div>
        ) : (
          <p className="mono mt-4 text-graphite" data-testid="want-checked" suppressHydrationWarning>{want.foundAt ? `Found ${ago(want.foundAt)}` : `Stores checked ${ago(want.lastSearchedAt)} · again every day`}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {want.foundAt ? (
            <button type="button" disabled={busy !== null} onClick={() => act("found", () => foundWantAction(want.id, false), () => router.refresh())} className="pill pill-solid" data-testid="want-unfound">Put it back on the list</button>
          ) : (
            <>
              <button type="button" disabled={running} onClick={() => void run(want.id, () => searchWantAction(want.id))} className="pill" data-testid="want-search-now">Search now</button>
              <button type="button" disabled={running} onClick={() => setEdit(true)} className="pill" data-testid="want-edit">Edit</button>
              <button type="button" disabled={busy !== null || running} onClick={() => act("found", () => foundWantAction(want.id, true), () => router.refresh())} className="pill pill-solid" data-testid="want-found">Found it</button>
            </>
          )}
          <button type="button" disabled={busy !== null} onClick={() => { if (confirm("Take this off the list?")) act("delete", () => deleteWantAction(want.id), () => router.push(`/shop/looking-for?for=${want.forPersonId}`)); }} className="pill pill-quiet" data-testid="want-delete">Remove</button>
        </div>
      </div>

      <section className="mt-6 lg:col-start-1 lg:row-start-3 lg:row-span-3 lg:mt-0" data-testid="want-matches">
        <div className="flex items-end justify-between border-b border-ink pb-2">
          <p className="mono text-graphite">{want.matches.length ? `${want.matches.length} ${want.matches.length === 1 ? "match" : "matches"} from ${stores} ${stores === 1 ? "store" : "stores"}` : "Matches"}</p>
          {fresh ? <p className="mono text-ink" data-testid="want-fresh">{fresh} new since you last looked</p> : null}
        </div>
        {want.matches.length ? (
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3">
            {want.matches.map((p) => (
              <div key={p.url} className={cn("min-w-0", p.isNew && "relative")} data-testid="want-match" data-new={p.isNew ? "1" : undefined}>
                <a href={p.url} target="_blank" rel="noreferrer" className="block h-[200px] overflow-hidden bg-bone" aria-label={p.title}>
                  {p.imageUrl ? <img src={p.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" /> : null}
                </a>
                {p.isNew ? <span className="mono absolute left-2 top-2 bg-ink px-1.5 py-0.5 text-paper">New</span> : null}
                <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug">{p.title}</p>
                <p className="mono mt-1 text-graphite">{[p.priceText, p.storeName].filter(Boolean).join(" · ")}</p>
                <div className="mt-2 flex flex-col gap-1.5">
                  <a href={p.url} target="_blank" rel="noreferrer" className="pill pill-sm w-full">Buy →</a>
                  <button type="button" onClick={() => router.push(`/shop?for=${want.forPersonId}&link=${encodeURIComponent(p.url)}`)} className="pill pill-sm pill-solid w-full" data-testid="want-judge">Judge it</button>
                </div>
              </div>
            ))}
          </div>
        ) : !running ? (
          <p className="mono mt-4 text-graphite" data-testid="want-none">Nothing in the stores for this yet{want.maxPrice ? ` under $${want.maxPrice}` : ""}. The Shop keeps checking every day; Edit the line to widen it.</p>
        ) : null}
        {want.matches.length ? <p className="mono mt-4 text-graphite">Judge it: the Shop says fits, risky or pass, and can show it on you.</p> : null}
      </section>

      <WantSheet open={edit} onClose={() => setEdit(false)} title="Change the line" value={want.text} onSave={(text) => void run(want.id, () => editWantAction(want.id, text))} />
    </div>
  );
}

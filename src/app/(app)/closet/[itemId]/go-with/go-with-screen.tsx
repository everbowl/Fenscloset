"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { cn } from "@/lib/cn";
import type { GoWithView } from "@/lib/shop/go-with";
import { goWithAction, goWithStatusAction, type GoWithResult } from "./actions";

/** How often the screen asks after a search that is still running. */
const POLL_MS = 2000;

/**
 * "Shop for something to go with it" (Jeff, 23 Oct 2026): the piece, what would complete it, real products for that
 * (Buy, or Judge it on the Shop), and the looks the closet already makes with it. The work runs in the background and
 * the screen shows the step and the seconds; today's answer is reused, "Look again" makes a fresh one.
 */
export function GoWithScreen({ itemId, name, thumbKey, fresh, initial }: { itemId: string; name: string; thumbKey: string | null; fresh: boolean; initial: GoWithView | null }) {
  const router = useRouter();
  const [view, setView] = useState<GoWithView | null>(initial);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ step: string; startedAt: number } | null>(null);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string>();
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { seq.current++; if (timer.current) clearTimeout(timer.current); }, []);
  const startedAt = progress?.startedAt ?? null;
  useEffect(() => {
    if (startedAt === null) return;
    const tick = () => setSecs(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const settle = useCallback((r: GoWithResult, mine: number) => {
    if (mine !== seq.current) return;
    if (!r.ok) { setBusy(false); setProgress(null); setError(r.error); return; }
    if ("view" in r) { setBusy(false); setProgress(null); setView(r.view); return; }
    setProgress((p) => ({ step: r.pending.step, startedAt: p?.startedAt ?? Date.now() }));
    timer.current = setTimeout(async () => {
      if (mine !== seq.current) return;
      let next: GoWithResult;
      try { next = await goWithStatusAction(r.pending.jobId); } catch { next = r; }
      settle(next, mine);
    }, POLL_MS);
  }, []);
  const run = useCallback(async (again: boolean) => {
    const mine = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    setError(undefined); setBusy(true); setProgress({ step: "Getting ready…", startedAt: Date.now() });
    let r: GoWithResult;
    try { r = await goWithAction(itemId, again); } catch { r = { ok: false, error: "Something went wrong. Try again." }; }
    settle(r, mine);
  }, [itemId, settle]);
  const started = useRef(false);
  useEffect(() => { if (started.current) return; started.current = true; if (!initial || fresh) void run(fresh); }, [fresh, initial, run]);

  const thumb = view?.piece.thumbKey ?? thumbKey;
  return (
    <div data-testid="go-with" className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-14">
      <div className="lg:col-span-2">
        <PageHeader eyebrow={<span className="text-ink" data-testid="go-with-piece">{name}</span>} title="Something to go" accent="with it" />
      </div>
      {error ? <Banner tone="danger" title={error} className="mb-3 lg:col-span-2" /> : null}

      <div className="lg:col-start-2 lg:row-start-3">
        <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4">
          <div className="h-[128px] overflow-hidden bg-bone">{thumb ? <img src={`/api/photo/${thumb}`} alt={name} className="size-full object-cover" /> : null}</div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="mono text-graphite">{view?.piece.label ?? "Piece"}{view ? ` · for ${view.forName}` : ""}</p>
            <p className="serif text-[26px] leading-none">{name}</p>
          </div>
        </div>
        {busy ? (
          <div className="mt-4" data-testid="go-with-thinking" aria-live="polite">
            <p className="mono flex items-center justify-between gap-3 text-ink"><span>{progress?.step ?? "Looking at the closet…"}</span><span className="shrink-0 text-graphite" aria-hidden>{secs}s</span></p>
            <p className="mono mt-1 text-graphite">Usually 15 to 40 seconds. You can leave this screen; the answer is kept on this page.</p>
          </div>
        ) : error ? (
          <button type="button" onClick={() => void run(Boolean(view))} className="pill mt-4" data-testid="go-with-retry">Try again</button>
        ) : view ? (
          <button type="button" onClick={() => void run(true)} className="pill pill-sm mt-4" data-testid="go-with-again">Look again</button>
        ) : null}
      </div>

      {view && !busy ? (
        <section className="mt-6 lg:col-start-1 lg:row-start-3 lg:row-span-3 lg:mt-0" data-testid="go-with-result">
          <div className="border-y border-ink py-2.5">
            <p className="mono text-ink">{view.needCategory ? `Would complete it · ${view.needCategory}` : "Already covered"}</p>
            <p className="serif mt-1.5 text-[21px] italic leading-[1.3]">{view.reason}</p>
          </div>
          {view.products.length ? (
            <div className="mt-6" data-testid="go-with-products">
              <div className="flex items-end justify-between border-b border-ink pb-2">
                <p className="mono text-graphite">{view.needCategory ? `${view.needCategory} to go with it` : "Worth a look"}</p>
                <p className="mono text-graphite">{view.products.length} from {new Set(view.products.map((p) => p.storeName)).size} stores</p>
              </div>
              <div className="-mx-5 mt-3 flex snap-x gap-2.5 overflow-x-auto px-5 pb-2 lg:mx-0 lg:px-0">
                {view.products.map((p) => (
                  <div key={p.url} className="w-[150px] shrink-0 snap-start" data-testid="go-with-product">
                    <a href={p.url} target="_blank" rel="noreferrer" className="block h-[190px] overflow-hidden bg-bone" aria-label={p.title}>
                      {p.imageUrl ? <img src={p.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" /> : null}
                    </a>
                    <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug">{p.title}</p>
                    <p className="mono mt-1 text-graphite">{[p.priceText, p.storeName].filter(Boolean).join(" · ")}</p>
                    <div className="mt-2 flex flex-col gap-1.5">
                      <a href={p.url} target="_blank" rel="noreferrer" className="pill pill-sm w-full" aria-label={`Buy ${p.title} at ${p.storeName}`}>Buy ↗</a>
                      <button type="button" onClick={() => router.push(`/shop?for=${view.forPersonId}&link=${encodeURIComponent(p.url)}`)} className="pill pill-sm pill-solid w-full" data-testid="go-with-judge">Judge it</button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mono mt-1 text-graphite">Judge it: the Shop says buy it, maybe or skip it, and can show it on you.</p>
            </div>
          ) : (
            <p className="mono mt-6 text-graphite" data-testid="go-with-no-products">Nothing in the stores right now for this. Try <Link href={`/shop?for=${view.forPersonId}`} className="text-ink underline underline-offset-4">the Shop</Link> with a link or a photo.</p>
          )}
          {view.closetLooks.length ? (
            <div className="mt-6 space-y-6" data-testid="go-with-looks">
              <p className="mono border-b border-ink pb-2 text-graphite">Already works with it, from the closet</p>
              {view.closetLooks.map((b, i) => (
                <div key={i}>
                  <div className="grid grid-cols-4 gap-1.5">
                    {b.pieces.slice(0, 4).map((x) => (
                      <Link key={x.id} href={`/closet/${x.id}`} className={cn("h-[112px] overflow-hidden bg-bone", x.id === view.itemId && "outline outline-2 -outline-offset-2 outline-ink")} aria-label={x.name}>
                        {x.thumbKey ? <img src={`/api/photo/${x.thumbKey}`} alt={x.name} className="size-full object-cover" /> : <span className="flex size-full items-end p-1.5"><span className="mono text-graphite">{x.name}</span></span>}
                      </Link>
                    ))}
                  </div>
                  <p className="mono mt-2 text-graphite">{b.pieces.map((x) => x.label).join(" · ")}</p>
                  <p className="serif mt-1 text-[21px] italic leading-[1.3]">{b.reason}</p>
                </div>
              ))}
            </div>
          ) : <p className="mono mt-6 text-graphite">Nothing else in the closet to pair it with yet.</p>}
        </section>
      ) : null}
    </div>
  );
}

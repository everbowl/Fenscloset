"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Sheet } from "@/components/ui/sheet";
import { TextSheet } from "@/components/items/row-editor";
import { shrinkPhoto } from "@/lib/import/client-queue";
import { cn } from "@/lib/cn";
import type { LookupView, SimilarItem } from "@/lib/shop/engine";
import type { BrandFeedView } from "@/lib/shop/brand-feed";
import { brandFeedAction, brandFeedStatusAction, deleteLookupAction, lookupLinkAction, lookupPhotoAction, lookupStatusAction, tryOnLookupAction, type FeedResult, type LookupResult } from "./actions";
import type { TryOnState, TryOnView } from "@/lib/tryon";
import { ago } from "./looking-for/ago";

const CALL_WORD = { FITS: "Fits · buy it", RISKY: "Risky · maybe", PASS: "Pass · skip it" } as const;
/** The call as the hero of the result: the word in serif, the gloss in mono. */
const CALL_HERO = { FITS: { word: "Fits", gloss: "Buy it" }, RISKY: { word: "Risky", gloss: "Maybe" }, PASS: { word: "Pass", gloss: "Skip it" } } as const;
/** How often the screen asks after a lookup that is still running. */
const POLL_MS = 2000;

export function ShopScreen({ meId, people, forPersonId, selected, recent, tryOn, mannequin, autoLink = null, lookingFor, brandFeed }: { meId: string; people: { id: string; name: string }[]; forPersonId: string; selected: LookupView | null; recent: LookupView[]; tryOn: TryOnState; /** SEE IT ON dresses the shared mannequin when the person's own try-on is not ready. */ mannequin: boolean; /** A store link to judge as soon as the page opens ("Judge it" from a piece's go-with page). */ autoLink?: string | null; /** The person's Looking-for list: how many lines are open and how many matches are new. */ lookingFor: { wants: number; newMatches: number }; /** "New from your brands": the feed as stored, refreshed in the background when stale. */ brandFeed: BrandFeedView }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<"link" | "photo" | "delete" | "tryon" | null>(null);
  const [progress, setProgress] = useState<{ step: string; startedAt: number } | null>(null);
  const [secs, setSecs] = useState(0);
  const [onMe, setOnMe] = useState<TryOnView | null>(null);
  const setError = (e?: string) => { if (e) toast.error(e); };
  const [sheet, setSheet] = useState<"for" | "link" | null>(null);
  const [compare, setCompare] = useState<SimilarItem | null>(null);
  const [source, setSource] = useState<"screenshot" | "photo">("screenshot");
  const file = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forMe = forPersonId === meId;
  const forName = forMe ? "me" : people.find((p) => p.id === forPersonId)?.name ?? "them";
  /** "you" or the person's name, for sentences about them. */
  const who = forMe ? "you" : forName;
  const pendingRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => { seq.current++; if (timer.current) clearTimeout(timer.current); }, []);
  const startedAt = progress?.startedAt ?? null;
  useEffect(() => {
    if (startedAt === null) return;
    const tick = () => setSecs(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  /** A lookup runs in the background: the first answer is the result when it was quick, else a job this asks about every two seconds. */
  const settle = useCallback((r: LookupResult, mine: number) => {
    if (mine !== seq.current) return; // a newer lookup took over
    if (!r.ok) { setBusy(null); setProgress(null); setError(r.error); return; }
    if ("id" in r) { setBusy(null); setProgress(null); router.replace(`/shop?for=${forPersonId}&l=${r.id}`); router.refresh(); return; }
    setProgress((p) => ({ step: r.pending.step, startedAt: p?.startedAt ?? Date.now() })); // the phone's own clock for the seconds, not the server's
    timer.current = setTimeout(async () => {
      if (mine !== seq.current) return;
      let next: LookupResult;
      try { next = await lookupStatusAction(r.pending.jobId); } catch { next = r; } // a dropped poll (phone asleep): ask again
      settle(next, mine);
    }, POLL_MS);
  }, [forPersonId, router]);
  function run(kind: "link" | "photo", fn: () => Promise<LookupResult>) {
    const mine = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    setError(undefined); setBusy(kind); setProgress({ step: "Looking at it…", startedAt: Date.now() });
    start(async () => {
      let r: LookupResult;
      try { r = await fn(); } catch { r = { ok: false, error: "Something went wrong. Try again." }; }
      settle(r, mine);
    });
  }
  function remove(id: string) {
    setError(undefined); setBusy("delete");
    start(async () => { const r = await deleteLookupAction(id); setBusy(null); if (!r.ok) setError(r.error); router.refresh(); });
  }
  // "Judge it" from a piece's go-with page lands here with the link: the lookup starts on its own, once.
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || !autoLink) return;
    auto.current = true;
    run("link", () => lookupLinkAction(forPersonId, autoLink));
    router.replace(`/shop?for=${forPersonId}`); // drop ?link= so Back never judges it again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLink, forPersonId]);
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    const blob = await shrinkPhoto(f, 1600);
    const fd = new FormData(); fd.set("photo", new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" })); fd.set("source", source);
    run("photo", () => lookupPhotoAction(forPersonId, fd));
  }
  const thinking = busy === "link" || busy === "photo";
  // The answer takes the result's place: scroll it into view (Judge it on a card can be far below).
  useEffect(() => { if (thinking) pendingRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [thinking]);

  // Shop v2 item 3 (Jeff, 23 Oct 2026): "suggest items from my favorite brands". The feed is refreshed in the
  // background when it is stale (never fetched, a day old, or the brand list changed) and on Refresh.
  const [feedBusy, setFeedBusy] = useState<{ step: string; startedAt: number } | null>(null);
  const [feedSecs, setFeedSecs] = useState(0);
  const feedSeq = useRef(0);
  const feedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { feedSeq.current++; if (feedTimer.current) clearTimeout(feedTimer.current); }, []);
  const feedStartedAt = feedBusy?.startedAt ?? null;
  useEffect(() => {
    if (feedStartedAt === null) return;
    const tick = () => setFeedSecs(Math.max(0, Math.floor((Date.now() - feedStartedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [feedStartedAt]);
  const settleFeed = useCallback((r: FeedResult, mine: number) => {
    if (mine !== feedSeq.current) return;
    if (!r.ok) { setFeedBusy(null); setError(r.error); return; }
    if ("done" in r) { setFeedBusy(null); router.refresh(); return; }
    setFeedBusy((p) => ({ step: r.pending.step, startedAt: p?.startedAt ?? Date.now() }));
    feedTimer.current = setTimeout(async () => {
      if (mine !== feedSeq.current) return;
      let next: FeedResult;
      try { next = await brandFeedStatusAction(r.pending.jobId); } catch { next = r; }
      settleFeed(next, mine);
    }, POLL_MS);
  }, [router]);
  const runFeed = useCallback(async () => {
    const mine = ++feedSeq.current;
    if (feedTimer.current) clearTimeout(feedTimer.current);
    setFeedBusy({ step: "Checking your brands…", startedAt: Date.now() });
    let r: FeedResult;
    try { r = await brandFeedAction(forPersonId); } catch { r = { ok: false, error: "Something went wrong. Try again." }; }
    settleFeed(r, mine);
  }, [forPersonId, settleFeed]);
  const feedStarted = useRef(false);
  useEffect(() => { if (brandFeed.stale && !feedStarted.current) { feedStarted.current = true; void runFeed(); } }, [brandFeed.stale, runFeed]);

  return (
    <div data-testid="shop" className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-14">
      <div className="order-1 lg:col-span-2">
        <PageHeader
          eyebrow={<button type="button" onClick={() => setSheet("for")} className="pill pill-sm" aria-haspopup="dialog" data-testid="shop-for">Shopping for {forPersonId === meId ? "me" : forName} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="m6 9 6 6 6-6" /></svg></button>}
          title="Should I" accent="buy it?" />
      </div>
      {/* The right column on desktop (the ways in, Recent); on phones its children take their own places in the order. */}
      <div className="contents lg:col-start-2 lg:row-start-2 lg:flex lg:flex-col lg:gap-8 lg:self-start lg:sticky lg:top-24">
      <div className="order-2">
        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" className="h-[54px] px-2 text-[11px]" disabled={thinking} onClick={() => setSheet("link")} data-testid="paste-link">Paste a link</Button>
          <Button variant="secondary" className="h-[54px] px-2 text-[11px]" disabled={thinking} onClick={() => { setSource("screenshot"); file.current?.removeAttribute("capture"); file.current?.click(); }} data-testid="upload-screenshot">Screenshot</Button>
          <Button variant="secondary" className="h-[54px] px-2 text-[11px]" disabled={thinking} onClick={() => { setSource("photo"); file.current?.setAttribute("capture", "environment"); file.current?.click(); }} data-testid="take-photo">Take a photo</Button>
        </div>
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={onFile} data-testid="shop-file" />
      </div>
      {/* Recent verdicts, each with its date. */}
      {recent.length > 1 || (recent.length === 1 && recent[0].id !== selected?.id) ? (
        <section className="order-6 mt-8 lg:mt-0" data-testid="recent">
          <h2 className="mono border-b border-ink pb-2 text-graphite">Recent</h2>
          {recent.map((r) => (
            <Link key={r.id} href={`/shop?for=${forPersonId}&l=${r.id}`} className={cn("tap flex h-[52px] items-center gap-3 border-b border-line", r.id === selected?.id && "bg-bone")} data-testid="recent-row">
              <span className="size-10 shrink-0 bg-bone">{r.imageKey ? <img src={`/api/photo/${r.imageKey}`} alt="" className="size-full object-cover" /> : null}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[14px]">{r.title ?? "New piece"}</span><span className="mono block text-graphite" suppressHydrationWarning>{CALL_WORD[r.verdict.call]}{r.priceText ? ` · ${r.priceText}` : ""} · {ago(r.createdAt)}</span></span>
            </Link>
          ))}
        </section>
      ) : null}
      </div>
      {/* The left column: the answer, then what is new. On phones the Looking-for strip sits under the answer. */}
      <div className="contents lg:col-start-1 lg:row-start-2 lg:flex lg:flex-col lg:gap-8">
      <div className="order-4 mt-6 lg:mt-0">
        {/* Shop v2 item 2 (Jeff, 23 Oct 2026): "state what I'm looking for so the shopping tool lets me know". */}
        <Link href={`/shop/looking-for?for=${forPersonId}`} className="tap flex items-center justify-between border border-ink px-4 py-3" data-testid="looking-for-link">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="serif text-[22px]">Looking for <em>something?</em></span>
            <span className={cn("mono", lookingFor.newMatches ? "text-ink" : "text-graphite")} data-testid="looking-for-line">{lookingFor.newMatches ? `${lookingFor.newMatches} new ${lookingFor.newMatches === 1 ? "match" : "matches"} · ${lookingFor.wants} on the list` : lookingFor.wants ? `${lookingFor.wants} on the list · nothing new yet` : "Tell the Shop what to find; it checks the stores every day"}</span>
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="shrink-0"><path d="M4 12h16M14 6l6 6-6 6" /></svg>
        </Link>
      </div>

      {thinking ? (
        <section ref={pendingRef} className="order-3 mt-6 scroll-mt-24 lg:mt-0" data-testid="shop-thinking">
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-4">
            <div className="h-[160px] animate-pulse bg-bone" />
            <div className="flex min-w-0 flex-col gap-2 pt-1"><div className="h-3 w-24 bg-bone" /><div className="h-7 w-40 bg-bone" /><div className="h-3 w-16 bg-bone" /></div>
          </div>
          <div className="mt-4 border-y border-ink py-2.5" aria-live="polite">
            <p className="mono flex items-center justify-between gap-3 text-ink"><span>{progress?.step ?? "Looking at it…"}</span><span className="shrink-0 text-graphite" aria-hidden>{secs}s</span></p>
            <p className="mono mt-1 text-graphite">Usually 15 to 40 seconds. You can leave this screen; the answer is kept under Recent.</p>
          </div>
        </section>
      ) : selected ? (
        <section className="order-3 mt-6 lg:mt-0" data-testid="shop-result">
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-4">
            <div className="h-[160px] overflow-hidden bg-bone">{selected.imageKey ? <img src={`/api/photo/${selected.imageKey}`} alt={selected.title ?? ""} className="size-full object-cover" /> : null}</div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="mono text-graphite">{[selected.read.categoryName, selected.brandText, selected.priceText].filter(Boolean).join(" · ") || "New piece"}</p>
              <p className="serif text-[30px] leading-none">{selected.title ?? "New piece"}</p>
              <p className="mono text-graphite" suppressHydrationWarning>For {selected.forPersonId === meId ? "me" : selected.forName} · judged {ago(selected.createdAt)}{selected.inputUrl ? <> · <a href={selected.inputUrl} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4">Open link ↗</a></> : null}</p>
            </div>
          </div>
          <div className="rise mt-4 border-y-2 border-ink py-3" data-testid="verdict" data-call={selected.verdict.call}>
            <p className="flex items-baseline gap-3"><span className="serif text-[44px] leading-none">{CALL_HERO[selected.verdict.call].word}</span><span className="mono text-ink">· {CALL_HERO[selected.verdict.call].gloss}</span></p>
            <p className="serif mt-2 text-[21px] italic leading-[1.3]">{selected.verdict.reason}</p>
            {selected.verdict.sizeNote ? <p className="mono mt-1.5 text-graphite">{selected.verdict.sizeNote}</p> : null}
            {!selected.verdict.usedBodyData ? <p className="mono mt-1.5 flex flex-wrap items-center gap-2 text-graphite">Judged on style and closet only{forMe ? <Link href="/profile/body" className="pill pill-sm" data-testid="add-my-sizes">Add my sizes</Link> : null}</p> : null}
          </div>
          {selected.imageKey && (tryOn === "ready" || mannequin) ? (
            <div className="mt-3">
              <Button variant="secondary" className="w-full" disabled={busy !== null} onClick={() => { setBusy("tryon"); setError(undefined); start(async () => { const r = await tryOnLookupAction(selected.id); setBusy(null); if (!r.ok) setError(r.error); else if (r.tryOn) setOnMe(r.tryOn); }); }} data-testid={tryOn === "ready" ? "see-it-on-me" : "see-on-mannequin"}>{busy === "tryon" ? (tryOn === "ready" ? `Dressing ${who}…` : "Dressing the mannequin…") : tryOn === "ready" ? (forMe ? "See it on me" : `See it on ${forName}`) : "See it on the mannequin"}</Button>
              {tryOn === "off" || tryOn === "no_photo" ? <Link href={tryOn === "off" ? "/profile/settings" : "/profile/body"} className="mono flex h-[38px] items-center justify-center text-graphite" data-testid={tryOn === "off" ? "try-on-off" : "try-on-photo"}>{tryOn === "off" ? "Want it on you? Turn on try-on in Settings" : "Want it on you? Add a body photo first"}</Link> : null}
            </div>
          ) : null}
          {selected.similar.length ? (
            // Jeff, 23 Oct 2026 (Shop v2, A): bigger, with a tap to see the two side by side.
            <div className="mt-5" data-testid="own-similar">
              <h2 className="mono border-b border-ink pb-2 text-graphite">{forMe ? "You already own" : `${forName} already owns`} similar · tap to compare</h2>
              <div className="-mx-5 mt-3 flex snap-x scroll-px-5 gap-2.5 overflow-x-auto px-5 pb-1 lg:mx-0 lg:scroll-px-0 lg:px-0">
                {selected.similar.map((s) => (
                  <button key={s.id} type="button" onClick={() => setCompare(s)} className="w-[110px] shrink-0 text-left" data-testid="own-similar-piece" aria-label={`Compare with ${s.name}`}>
                    <span className="block h-[146px] overflow-hidden bg-bone">{s.thumbKey ? <img src={`/api/photo/${s.thumbKey}`} alt="" className="size-full object-cover" /> : null}</span>
                    <span className="mt-1.5 block truncate text-[13px] font-medium">{s.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {selected.pairings.length ? (
            <div className="mt-6 space-y-6" data-testid="pairings">
              <h2 className="mono border-b border-ink pb-2 text-graphite">Wear it with</h2>
              {selected.pairings.map((b, i) => (
                <div key={i}>
                  <div className="grid grid-cols-4 gap-1.5">
                    {b.pieces.slice(0, 4).map((x) => {
                      const tile = x.thumbKey ? <img src={`/api/photo/${x.thumbKey}`} alt={x.name} className={cn("size-full", x.id === "candidate" ? "object-cover" : "object-contain")} /> : <div className="flex size-full items-end p-1.5"><span className="mono text-graphite">{x.name}</span></div>;
                      return x.id === "candidate"
                        ? <div key={x.id} className="h-[112px] overflow-hidden bg-bone outline outline-2 -outline-offset-2 outline-ink">{tile}</div>
                        : <Link key={x.id} href={`/closet/${x.id}`} className="tap block h-[112px] overflow-hidden bg-bone" aria-label={x.name}>{tile}</Link>;
                    })}
                  </div>
                  <p className="mono mt-2 text-graphite">{b.pieces.map((x) => x.label).join(" · ")}</p>
                  <p className="serif mt-1 text-[21px] italic leading-[1.3]">{b.reason}</p>
                </div>
              ))}
            </div>
          ) : <p className="mono mt-6 text-graphite">Nothing in {selected.forPersonId === meId ? "your" : `${selected.forName}’s`} closet to pair it with yet.</p>}
          {selected.products.length ? (
            <div className="mt-6" data-testid="products">
              <div className="flex items-end justify-between border-b border-ink pb-2">
                <h2 className="mono text-graphite">{selected.verdict.missingCategory ? `${selected.verdict.missingCategory} to go with it` : "Instead of this"}</h2>
                <p className="mono text-graphite">{selected.products.length} from {new Set(selected.products.map((p) => p.storeName)).size} {new Set(selected.products.map((p) => p.storeName)).size === 1 ? "store" : "stores"}</p>
              </div>
              <div className="-mx-5 mt-3 flex snap-x scroll-px-5 gap-2.5 overflow-x-auto px-5 pb-2 lg:mx-0 lg:grid lg:grid-cols-3 lg:scroll-px-0 lg:px-0" data-testid="product-row">
                {selected.products.map((p) => (
                  <div key={p.url} className="w-[150px] shrink-0 snap-start lg:w-auto" data-testid="product">
                    <a href={p.url} target="_blank" rel="noreferrer" className="block h-[190px] overflow-hidden bg-bone" aria-label={p.title}>
                      {p.imageUrl ? <img src={p.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" /> : null}
                    </a>
                    <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug">{p.title}</p>
                    <p className="mono mt-1 text-graphite">{[p.priceText, p.storeName].filter(Boolean).join(" · ")}</p>
                    <div className="mt-2 flex flex-col gap-1.5">
                      <a href={p.url} target="_blank" rel="noreferrer" className="pill pill-sm w-full" aria-label={`Buy ${p.title} at ${p.storeName}`}>Buy ↗</a>
                      <button type="button" disabled={thinking} onClick={() => run("link", () => lookupLinkAction(forPersonId, p.url))} className="pill pill-sm pill-solid w-full" aria-label={`Judge ${p.title}`} data-testid="judge-product">Judge it</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {selected.recommendations.length && !selected.products.length ? (
            <div className="mt-6" data-testid="picks">
              <h2 className="mono border-b border-ink pb-2 text-graphite">You might like</h2>
              {selected.recommendations.map((r, i) => (
                <a key={i} href={r.url} target="_blank" rel="noreferrer" className="flex h-[42px] items-center border-b border-line">
                  <span className="mono w-[120px] shrink-0 text-graphite">{r.storeName}</span>
                  <span className="flex-1 truncate text-[14px]">{r.label}</span>
                  <span className="mono text-ink">Buy →</span>
                </a>
              ))}
            </div>
          ) : null}
          {(selected.shopperId === meId || selected.forPersonId === meId) ? <button type="button" disabled={busy === "delete"} onClick={() => remove(selected.id)} className="pill pill-sm pill-quiet mt-5" data-testid="remove-lookup">Remove</button> : null}
        </section>
      ) : (
        <section className="order-3 mt-6 lg:mt-0" data-testid="shop-empty">
          <ol className="grid grid-cols-3 gap-2" aria-label="How it works">
            {[["01", "Show it", "A store link, a screenshot, or a photo"], ["02", "The verdict", "Fits, risky, or pass, with one reason"], ["03", "Wear it", "What you own that goes with it"]].map(([n, t, d]) => (
              <li key={n} className="flex min-h-[150px] flex-col justify-between border border-ink p-3"><span className="mono text-graphite">{n}</span><span><span className="serif block text-[22px] leading-none">{t}</span><span className="mono mt-1.5 block text-graphite">{d}</span></span></li>
            ))}
          </ol>
          <p className="serif mt-3.5 text-[21px] italic leading-[1.3]">Thinking about something? Show it to the Shop before you pay.</p>
        </section>
      )}

      <section className="order-5 mt-8 lg:mt-0" data-testid="brand-feed">
        <div className="flex items-end justify-between gap-3 border-b border-ink pb-2">
          <h2 className="mono text-graphite">New from {forPersonId === meId ? "your" : `${forName}’s`} brands</h2>
          {feedBusy ? <p className="mono shrink-0 text-ink" data-testid="brand-feed-thinking"><span aria-live="polite">{feedBusy.step}</span><span aria-hidden> · {feedSecs}s</span></p>
            : brandFeed.newCount ? <p className="mono shrink-0 text-ink" data-testid="brand-feed-new">{brandFeed.newCount} new</p>
            : brandFeed.brands.length ? <button type="button" onClick={() => void runFeed()} className="pill pill-sm shrink-0" data-testid="brand-feed-refresh">Refresh</button> : null}
        </div>
        {brandFeed.brands.length ? <p className="mono mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-graphite" data-testid="brand-feed-brands" suppressHydrationWarning><span>{brandFeed.brands.join(" · ")}{brandFeed.lastFetchedAt ? ` · checked ${ago(brandFeed.lastFetchedAt)}` : ""}</span>{forMe ? <Link href="/profile/brands" className="pill pill-sm" data-testid="brand-feed-add">+ Add brand</Link> : null}</p> : null}
        {!brandFeed.brands.length ? (
          <div className="mt-3" data-testid="brand-feed-none">
            <p className="serif text-[21px] italic leading-[1.3]">{forPersonId === meId ? "Pick the brands you love and the Shop shows what’s new from them, every day." : `When ${forName} picks favorite brands in their Profile, what’s new from them shows here every day.`}</p>
            {forPersonId === meId ? <Link href="/profile/brands" className="pill mt-3" data-testid="brand-feed-pick">Pick my brands</Link> : null}
          </div>
        ) : brandFeed.products.length ? (
          <div className="-mx-5 mt-3 flex snap-x scroll-px-5 gap-2.5 overflow-x-auto px-5 pb-2 lg:mx-0 lg:grid lg:grid-cols-3 lg:scroll-px-0 lg:px-0">
            {brandFeed.products.map((p) => (
              <div key={p.url} className="relative w-[150px] shrink-0 snap-start lg:w-auto" data-testid="brand-feed-product" data-new={p.isNew ? "1" : undefined}>
                <a href={p.url} target="_blank" rel="noreferrer" className="block h-[190px] overflow-hidden bg-bone" aria-label={p.title}>
                  {p.imageUrl ? <img src={p.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" /> : null}
                </a>
                {p.isNew ? <span className="mono absolute left-2 top-2 bg-ink px-1.5 py-0.5 text-paper">New</span> : null}
                <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug">{p.title}</p>
                <p className="mono mt-1 text-graphite">{[p.priceText, p.storeName].filter(Boolean).join(" · ")}</p>
                <div className="mt-2 flex flex-col gap-1.5">
                  <a href={p.url} target="_blank" rel="noreferrer" className="pill pill-sm w-full" aria-label={`Buy ${p.title} at ${p.storeName}`}>Buy ↗</a>
                  <button type="button" disabled={thinking} onClick={() => run("link", () => lookupLinkAction(forPersonId, p.url))} className="pill pill-sm pill-solid w-full" aria-label={`Judge ${p.title}`} data-testid="brand-feed-judge">Judge it</button>
                </div>
              </div>
            ))}
          </div>
        ) : feedBusy ? null : <p className="mono mt-3 text-graphite" data-testid="brand-feed-empty">Nothing from these brands in the stores right now. Refresh to look again.</p>}
      </section>

      </div>

      <Sheet open={onMe !== null} onClose={() => setOnMe(null)} title={onMe?.mannequin ? "On a mannequin" : forMe ? "On you" : `On ${forName}`}>
        {onMe ? (
          <div className="flex flex-col gap-3" data-testid="see-it-on-me-sheet">
            <div className="h-[460px] overflow-hidden bg-bone"><img src={`/api/photo/${onMe.key}`} alt={onMe.mannequin ? "This piece on a mannequin" : "You wearing this piece"} className="size-full object-contain" /></div>
            <p className="mono text-graphite">{onMe.mannequin ? "No body photo used" : forMe ? "Only you can see this picture" : `Only ${forName} and you can see this picture`}{onMe.cached ? " · saved from before" : ""}</p>
          </div>
        ) : null}
      </Sheet>
      <Sheet open={compare !== null} onClose={() => setCompare(null)} title="Side by side">
        {compare && selected ? (
          <div data-testid="compare-sheet">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="h-[260px] overflow-hidden bg-bone">{selected.imageKey ? <img src={`/api/photo/${selected.imageKey}`} alt={selected.title ?? "The new piece"} className="size-full object-cover" /> : null}</div>
                <p className="mono mt-2 text-graphite">New</p>
                <p className="truncate text-[14px] font-medium">{selected.title ?? "New piece"}</p>
              </div>
              <div>
                <div className="h-[260px] overflow-hidden bg-bone">{compare.thumbKey ? <img src={`/api/photo/${compare.thumbKey}`} alt={compare.name} className="size-full object-cover" /> : null}</div>
                <p className="mono mt-2 text-graphite">Yours</p>
                <p className="truncate text-[14px] font-medium">{compare.name}</p>
              </div>
            </div>
            <Link href={`/closet/${compare.id}`} className="pill mt-4 h-[50px] w-full">Open yours in the closet</Link>
          </div>
        ) : null}
      </Sheet>
      <Sheet open={sheet === "for"} onClose={() => setSheet(null)} title="Shopping for">
        <div className="flex flex-col" role="listbox">
          {people.map((p) => <Link key={p.id} href={`/shop?for=${p.id}`} role="option" aria-selected={p.id === forPersonId} onClick={() => setSheet(null)} className="flex h-12 items-center justify-between border-b border-line text-[15px]"><span>{p.id === meId ? `${p.name} (me)` : p.name}</span><span className={cn("mono", p.id === forPersonId ? "text-ink" : "text-transparent")}>✓</span></Link>)}
        </div>
        <p className="mono mt-4 text-graphite">You can shop for yourself, your kids, and anyone who allowed it in their Settings.</p>
      </Sheet>
      <TextSheet open={sheet === "link"} onClose={() => setSheet(null)} title="Paste a link" label="Store link" kind="url" submitLabel="Judge it" value="" placeholder="https://www.everlane.com/products/…" onSave={(v) => run("link", () => lookupLinkAction(forPersonId, v))} />
    </div>
  );
}

"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { SectionPick } from "@/components/shop/section-pick";
import { Button, Icons } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Sheet } from "@/components/ui/sheet";
import { TextSheet } from "@/components/items/row-editor";
import { UndoStrip, useUndoable } from "@/components/ui/undo-strip";
import { shrinkPhoto } from "@/lib/import/client-queue";
import { cn } from "@/lib/cn";
import type { LookupView, SimilarItem } from "@/lib/shop/engine";
import type { BrandFeedView } from "@/lib/shop/brand-feed";
import type { Product } from "@/lib/shop/products";
import { AddToLook } from "@/components/looks/add-to-look";
import { brandFeedAction, brandFeedStatusAction, deleteLookupAction, lookupLinkAction, lookupPhotoAction, lookupStatusAction, rememberShopForAction, tryOnLookupAction, type FeedResult, type LookupResult } from "./actions";
import type { TryOnState, TryOnView } from "@/lib/tryon";
import { ago } from "./looking-for/ago";

/** The call in plain words (the owner, 31 Oct 2026, L1): it answers "Should I buy it?" directly. The hero line is the word alone. */
const CALL_WORD = { FITS: "Buy it", RISKY: "Maybe", PASS: "Skip it" } as const;
/** How often the screen asks after a lookup that is still running. */
const POLL_MS = 2000;

/** One store find as a card: picture on the stage, name, price · store, then Buy, Judge it and Add to a look. */
function ProductCard({ p, isNew, onJudge, judging, personId, category, testId, judgeTestId, lookTestId }: { p: Product & { isNew?: boolean }; isNew?: boolean; onJudge: () => void; judging: boolean; personId: string; category: string | null | undefined; testId: string; judgeTestId: string; lookTestId: string }) {
  return (
    <div className="relative w-[150px] shrink-0 snap-start lg:w-auto" data-testid={testId} data-new={isNew ? "1" : undefined}>
      <a href={p.url} target="_blank" rel="noreferrer" className="stage block h-[190px] overflow-hidden" aria-label={p.title}>
        {p.imageUrl ? <img src={p.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" /> : null}
      </a>
      {isNew ? <span className="mono absolute left-2 top-2 rounded-full bg-ink px-2 py-0.5 text-paper">New</span> : null}
      <p className="mt-2 line-clamp-2 text-[14px] font-medium leading-snug">{p.title}</p>
      <p className="caption mt-0.5">{[p.priceText, p.storeName].filter(Boolean).join(" · ")}</p>
      <div className="mt-2 flex flex-col gap-1.5">
        <a href={p.url} target="_blank" rel="noreferrer" className="pill pill-sm w-full" aria-label={`Buy ${p.title} at ${p.storeName}`}>Buy ↗</a>
        <button type="button" disabled={judging} onClick={onJudge} className="pill pill-sm pill-solid w-full" aria-label={`Judge ${p.title}`} data-testid={judgeTestId}>Judge it</button>
        <AddToLook personId={personId} piece={{ title: p.title, url: p.url, storeName: p.storeName, priceText: p.priceText, imageUrl: p.imageUrl, category: category ?? null }} testId={lookTestId} />
      </div>
    </div>
  );
}

export function ShopScreen({ meId, people, forPersonId, selected, recent, tryOn, mannequin, autoLink = null, lookingFor, brandFeed, section, sections, isAdmin }: { meId: string; people: { id: string; name: string }[]; forPersonId: string; /** The section the person shops in (A1): asked right here while unset. */ section: { id: string; name: string } | null; sections: { id: string; name: string }[]; isAdmin: boolean; selected: LookupView | null; recent: LookupView[]; tryOn: TryOnState; /** SEE IT ON dresses the shared mannequin when the person's own try-on is not ready. */ mannequin: boolean; /** A store link to judge as soon as the page opens ("Judge it" from a piece's go-with page). */ autoLink?: string | null; /** The person's Looking-for list: how many lines are open and how many matches are new. */ lookingFor: { wants: number; newMatches: number }; /** "New from your brands": the feed as stored, refreshed in the background when stale. */ brandFeed: BrandFeedView }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<"link" | "photo" | "delete" | "tryon" | null>(null);
  const [progress, setProgress] = useState<{ step: string; startedAt: number } | null>(null);
  const [secs, setSecs] = useState(0);
  const [onMe, setOnMe] = useState<TryOnView | null>(null);
  const setError = (e?: string) => { if (e) toast.error(e); };
  const [sheet, setSheet] = useState<"for" | "link" | null>(null);
  const [compare, setCompare] = useState<SimilarItem | null>(null);
  const undoable = useUndoable();
  const [hidden, setHidden] = useState<string | null>(null); // a verdict taken away, until its strip runs out (Q1)
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
    if (!r.ok) {
      setBusy(null); setProgress(null); setError(r.error);
      if (/gone/.test(r.error)) router.refresh(); // the job was lost to a restart; the saved verdict, if any, is under Recent (review E H2)
      return;
    }
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
  const thinking = busy === "link" || busy === "photo";
  async function judgeFile(f: File, from: "screenshot" | "photo") {
    // A cancelled share sheet or a picture WebKit cannot decode throws before the action runs: say so (review E H1).
    try {
      const blob = await shrinkPhoto(f, 1600);
      if (!blob.size) throw new Error("empty");
      const fd = new FormData(); fd.set("photo", new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" })); fd.set("source", from);
      run("photo", () => lookupPhotoAction(forPersonId, fd));
    } catch { toast.error("Couldn't read that picture. Try another one."); }
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (f) await judgeFile(f, source);
  }
  // On a computer: drop a picture anywhere on the screen, or paste one (M1).
  const [over, setOver] = useState(false);
  const drop = {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: async (e: React.DragEvent) => { e.preventDefault(); setOver(false); const f = Array.from(e.dataTransfer.files ?? []).find((x) => x.type.startsWith("image/")); if (f && !thinking) await judgeFile(f, "screenshot"); },
  };
  // The paste listener is registered once; it reads the current judgeFile and busy state through refs (review E H3: it used to be re-added on every poll tick).
  const pasteRef = useRef({ judgeFile, thinking });
  pasteRef.current = { judgeFile, thinking };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]")) return;
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
      if (f && !pasteRef.current.thinking) { e.preventDefault(); void pasteRef.current.judgeFile(f, "screenshot"); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);
  // The answer takes the result's place: scroll it into view (Judge it on a card can be far below).
  useEffect(() => { if (thinking) pendingRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [thinking]);

  // Shop v2 item 3 (the owner, 23 Oct 2026): "suggest items from my favorite brands". The feed is refreshed in the
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
    if (!r.ok) { setFeedBusy(null); setError(r.error); router.refresh(); return; } // the row keeps the reason, so re-read it
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

  const judge = (url: string) => run("link", () => lookupLinkAction(forPersonId, url));
  const stores = (ps: Product[]) => new Set(ps.map((p) => p.storeName)).size;

  return (
    <div data-testid="shop" className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-14" {...drop}>
      <div className="order-1 lg:col-span-2">
        <PageHeader
          eyebrow={<span className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setSheet("for")} className="pill pill-sm" aria-haspopup="dialog" data-testid="shop-for">Shopping for {forPersonId === meId ? "me" : forName} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="m6 9 6 6 6-6" /></svg></button>{section ? <SectionPick personId={forPersonId} forName={forName} mine={forPersonId === meId} section={section} sections={sections} isAdmin={isAdmin} /> : null}</span>}
          title="Should I" accent="buy it?" />
        {!section ? <SectionPick personId={forPersonId} forName={forName} mine={forPersonId === meId} section={null} sections={sections} isAdmin={isAdmin} className="mb-4" /> : null}
      </div>
      {/* The right column on desktop (the ways in, Recent); on phones its children take their own places in the order. */}
      <div className="contents lg:col-start-2 lg:row-start-2 lg:flex lg:flex-col lg:gap-8 lg:self-start lg:sticky lg:top-24">
      <div className="order-2">
        {/* the owner, 31 Oct 2026 (M1): one orange way in, the other two beside it; a computer can also drop or paste a picture. */}
        <Button size="lg" className="w-full" icon={<Icons.link />} sub="Any store page" disabled={thinking} onClick={() => setSheet("link")} data-testid="paste-link">Paste a link</Button>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-[50px] px-2 text-[14px]" disabled={thinking} onClick={() => { setSource("screenshot"); file.current?.removeAttribute("capture"); file.current?.click(); }} data-testid="upload-screenshot">Screenshot</Button>
          <Button variant="outline" className="h-[50px] px-2 text-[14px]" disabled={thinking} onClick={() => { setSource("photo"); file.current?.setAttribute("capture", "environment"); file.current?.click(); }} data-testid="take-photo">Take a photo</Button>
        </div>
        <p className={cn("caption mt-2 hidden text-center lg:block", over && "text-ink")} data-testid="shop-drop-hint">{over ? "Drop it to judge it" : "Or drop a picture here, or paste one"}</p>
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={onFile} data-testid="shop-file" />
      </div>
      {/* Recent verdicts, each with its date. */}
      {recent.length > 1 || (recent.length === 1 && recent[0].id !== selected?.id) ? (
        <section className="order-6 mt-8 lg:mt-0" data-testid="recent">
          <h2 className="section">Recent</h2>
          <div className="card mt-3 divide-y divide-line overflow-hidden p-0">
            {recent.map((r) => (
              <Link key={r.id} href={`/shop?for=${forPersonId}&l=${r.id}`} className={cn("tap flex h-14 items-center gap-3 px-3", r.id === selected?.id && "bg-bone")} data-testid="recent-row" aria-current={r.id === selected?.id ? "true" : undefined}>
                <span className="stage size-10 shrink-0 overflow-hidden rounded-[10px]">{r.imageKey ? <img src={`/api/photo/${r.imageKey}`} alt="" className="size-full object-cover" /> : null}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{r.title ?? "New piece"}</span><span className="caption block" suppressHydrationWarning>{CALL_WORD[r.verdict.call]}{r.priceText ? ` · ${r.priceText}` : ""} · {ago(r.createdAt)}</span></span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      </div>
      {/* The left column: the answer, then what is new. On phones the Looking-for strip sits under the answer. */}
      <div className="contents lg:col-start-1 lg:row-start-2 lg:flex lg:flex-col lg:gap-8">
      <div className="order-4 mt-6 lg:mt-0">
        {/* Shop v2 item 2 (the owner, 23 Oct 2026): "state what I'm looking for so the shopping tool lets me know". */}
        <Link href={`/shop/looking-for?for=${forPersonId}`} className="card tap flex min-h-[64px] items-center justify-between gap-3 px-4 py-3" data-testid="looking-for-link">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[17px] font-semibold">Looking for something?</span>
            <span className={cn("caption", lookingFor.newMatches > 0 && "text-ink")} data-testid="looking-for-line">{lookingFor.newMatches ? `${lookingFor.newMatches} new ${lookingFor.newMatches === 1 ? "match" : "matches"} · ${lookingFor.wants} on the list` : lookingFor.wants ? `${lookingFor.wants} on the list · nothing new yet` : "Tell the Shop what to find; it checks the stores every day"}</span>
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="shrink-0 text-graphite"><path d="M4 12h16M14 6l6 6-6 6" /></svg>
        </Link>
      </div>

      {thinking ? (
        <section ref={pendingRef} className="order-3 mt-6 scroll-mt-24 lg:mt-0" data-testid="shop-thinking">
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-4">
            <div className="stage h-[160px] animate-pulse motion-reduce:animate-none" />
            <div className="flex min-w-0 flex-col gap-2 pt-1"><div className="h-3 w-24 rounded-full bg-bone" /><div className="h-7 w-40 rounded-full bg-bone" /><div className="h-3 w-16 rounded-full bg-bone" /></div>
          </div>
          <div className="card mt-4 px-4 py-3" aria-live="polite">
            <p className="flex items-center justify-between gap-3 text-[15px] font-medium"><span>{progress?.step ?? "Looking at it…"}</span><span className="caption shrink-0" aria-hidden>{secs}s</span></p>
            <p className="note mt-1">Usually 15 to 40 seconds. You can leave this screen; the answer is kept under Recent.</p>
          </div>
        </section>
      ) : selected && hidden === selected.id && undoable.pending ? (
        <section className="order-3 mt-6 lg:mt-0" data-testid="shop-removed"><UndoStrip text={`${undoable.pending.text} · ${selected.title ?? "New piece"}`} onUndo={undoable.undo} testId="shop-undo" /></section>
      ) : selected ? (
        <section className="order-3 mt-6 lg:mt-0" data-testid="shop-result">
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-4">
            <div className="stage h-[160px] overflow-hidden">{selected.imageKey ? <img src={`/api/photo/${selected.imageKey}`} alt={selected.title ?? ""} className="size-full object-cover" /> : null}</div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="caption">{[selected.read.categoryName, selected.brandText, selected.priceText].filter(Boolean).join(" · ") || "New piece"}</p>
              <p className="section">{selected.title ?? "New piece"}</p>
              <p className="caption" suppressHydrationWarning>For {selected.forPersonId === meId ? "me" : selected.forName} · judged {ago(selected.createdAt)}{selected.inputUrl ? <> · <a href={selected.inputUrl} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4">Open link ↗</a></> : null}</p>
            </div>
          </div>
          <div className="card rise mt-4 px-4 py-4" data-testid="verdict" data-call={selected.verdict.call}>
            <p className="title" data-testid="verdict-word">{CALL_WORD[selected.verdict.call]}</p>
            <p className="mt-2 text-[17px] leading-snug">{selected.verdict.reason}</p>
            {selected.verdict.sizeNote ? <p className="note mt-1.5">{selected.verdict.sizeNote}</p> : null}
            {!selected.verdict.usedBodyData ? <p className="caption mt-2 flex flex-wrap items-center gap-2">Judged on style and closet only{forMe ? <Link href="/profile/body" className="pill pill-sm" data-testid="add-my-sizes">Add my sizes</Link> : null}</p> : null}
          </div>
          {selected.imageKey && (tryOn === "ready" || mannequin) ? (
            <div className="mt-3">
              <Button variant="outline" className="w-full" disabled={busy !== null} onClick={() => { setBusy("tryon"); setError(undefined); start(async () => { const r = await tryOnLookupAction(selected.id); setBusy(null); if (!r.ok) setError(r.error); else if (r.tryOn) setOnMe(r.tryOn); }); }} data-testid={tryOn === "ready" ? "see-it-on-me" : "see-on-mannequin"}>{busy === "tryon" ? (tryOn === "ready" ? `Dressing ${who}…` : "Dressing the mannequin…") : tryOn === "ready" ? (forMe ? "See it on me" : `See it on ${forName}`) : "See it on the mannequin"}</Button>
              {tryOn === "off" || tryOn === "no_photo" ? <Link href={tryOn === "off" ? "/profile/settings" : "/profile/body"} className="caption flex h-[38px] items-center justify-center" data-testid={tryOn === "off" ? "try-on-off" : "try-on-photo"}>{tryOn === "off" ? "Want it on you? Turn on try-on in Settings" : "Want it on you? Add a body photo first"}</Link> : null}
            </div>
          ) : null}
          {selected.inputUrl || selected.imageKey ? (
            // The judged piece itself into a look (B1), with its link and its picture.
            <div className="mt-2"><AddToLook personId={forPersonId} piece={{ title: selected.title ?? selected.read.name, url: selected.inputUrl, priceText: selected.priceText, imageKey: selected.imageKey, category: selected.read.categoryName }} testId="lookup-add-look" /></div>
          ) : null}
          {selected.similar.length ? (
            // the owner, 23 Oct 2026 (Shop v2, A): bigger, with a tap to see the two side by side.
            <div className="mt-6" data-testid="own-similar">
              <h2 className="section">{forMe ? "You already own" : `${forName} already owns`} similar</h2>
              <p className="caption mt-0.5">Tap one to compare</p>
              <div className="strip -mx-5 mt-3 snap-x scroll-px-5 gap-2.5 px-5 pb-1 lg:mx-0 lg:scroll-px-0 lg:px-0">
                {selected.similar.map((s) => (
                  <button key={s.id} type="button" onClick={() => setCompare(s)} className="w-[110px] shrink-0 text-left" data-testid="own-similar-piece" aria-label={`Compare with ${s.name}`}>
                    <span className="stage block h-[146px] overflow-hidden">{s.thumbKey ? <img src={`/api/photo/${s.thumbKey}`} alt="" className="size-full object-cover" /> : null}</span>
                    <span className="mt-1.5 block truncate text-[14px] font-medium">{s.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {selected.pairings.length ? (
            <div className="mt-6 space-y-5" data-testid="pairings">
              <h2 className="section">Wear it with</h2>
              {selected.pairings.map((b, i) => (
                <div key={i} className="card p-3">
                  <div className="grid grid-cols-4 gap-1.5">
                    {b.pieces.slice(0, 4).map((x) => {
                      const tile = x.thumbKey ? <img src={`/api/photo/${x.thumbKey}`} alt={x.name} className={cn("size-full", x.id === "candidate" ? "object-cover" : "object-contain")} /> : <div className="flex size-full items-end p-1.5"><span className="caption">{x.name}</span></div>;
                      return x.id === "candidate"
                        ? <div key={x.id} className="stage h-[112px] overflow-hidden outline outline-2 -outline-offset-2 outline-ink">{tile}</div>
                        : <Link key={x.id} href={`/closet/${x.id}`} className="stage tap block h-[112px] overflow-hidden" aria-label={x.name}>{tile}</Link>;
                    })}
                  </div>
                  <p className="caption mt-2">{b.pieces.map((x) => x.label).join(" · ")}</p>
                  <p className="mt-1 text-[16px] leading-snug">{b.reason}</p>
                </div>
              ))}
            </div>
          ) : <p className="note mt-6">Nothing in {selected.forPersonId === meId ? "your" : `${selected.forName}’s`} closet to pair it with yet.</p>}
          {selected.products.length ? (
            <div className="mt-6" data-testid="products">
              <div className="flex items-end justify-between gap-3">
                <h2 className="section">{selected.verdict.missingCategory ? `${selected.verdict.missingCategory} to go with it` : "Instead of this"}</h2>
                <p className="caption shrink-0">{selected.products.length} from {stores(selected.products)} {stores(selected.products) === 1 ? "store" : "stores"}</p>
              </div>
              <div className="strip -mx-5 mt-3 snap-x scroll-px-5 gap-2.5 px-5 pb-2 lg:mx-0 lg:grid lg:grid-cols-3 lg:scroll-px-0 lg:px-0" data-testid="product-row">
                {selected.products.map((p) => <ProductCard key={p.url} p={p} onJudge={() => judge(p.url)} judging={thinking} personId={forPersonId} category={selected.verdict.missingCategory} testId="product" judgeTestId="judge-product" lookTestId="product-add-look" />)}
              </div>
            </div>
          ) : null}
          {selected.recommendations.length && !selected.products.length ? (
            <div className="mt-6" data-testid="picks">
              <h2 className="section">You might like</h2>
              {selected.storesFailed ? <p className="note mt-1" data-testid="stores-failed">The stores didn't answer, so these are search links instead.</p> : null}
              <div className="card mt-3 divide-y divide-line overflow-hidden p-0">
                {selected.recommendations.map((r, i) => (
                  <a key={i} href={r.url} target="_blank" rel="noreferrer" className="tap flex h-12 items-center gap-3 px-3">
                    <span className="caption w-[110px] shrink-0 truncate">{r.storeName}</span>
                    <span className="flex-1 truncate text-[15px]">{r.label}</span>
                    <span className="mono text-ink">Buy →</span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          {(selected.shopperId === meId || selected.forPersonId === meId) ? <button type="button" disabled={busy === "delete"} onClick={() => { const id = selected.id; setHidden(id); undoable.start("Removed", () => { setHidden(null); remove(id); }, () => setHidden(null)); }} className="pill pill-sm pill-quiet mt-5" data-testid="remove-lookup">Remove</button> : null}
        </section>
      ) : (
        <section className="order-3 mt-6 lg:mt-0" data-testid="shop-empty">
          <ol className="grid grid-cols-3 gap-2" aria-label="How it works">
            {[["1", "Show it", "A store link, a screenshot, or a photo"], ["2", "The verdict", "Buy it, maybe, or skip it, with one reason"], ["3", "Wear it", "What you own that goes with it"]].map(([n, t, d]) => (
              <li key={n} className="card flex min-h-[150px] flex-col p-3"><span className="caption">{n}</span><span className="mt-4 block text-[17px] font-semibold leading-tight">{t}</span><span className="note mt-1.5 block text-[14px]">{d}</span></li>
            ))}
          </ol>
          <p className="note mt-3.5 text-ink text-[16px]">Thinking about something? Show it to the Shop before you pay.</p>
        </section>
      )}

      <section className="order-5 mt-8 lg:mt-0" data-testid="brand-feed">
        <div className="flex items-end justify-between gap-3">
          <h2 className="section">New from {forPersonId === meId ? "your" : `${forName}’s`} brands</h2>
          {feedBusy ? <p className="caption shrink-0 text-ink" data-testid="brand-feed-thinking"><span aria-live="polite">{feedBusy.step}</span><span aria-hidden> · {feedSecs}s</span></p>
            : brandFeed.newCount ? <p className="caption shrink-0 text-ink" data-testid="brand-feed-new">{brandFeed.newCount} new</p>
            : brandFeed.brands.length ? <button type="button" onClick={() => void runFeed()} className="pill pill-sm shrink-0" data-testid="brand-feed-refresh">Refresh</button> : null}
        </div>
        {brandFeed.brands.length ? <p className="caption mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="brand-feed-brands" suppressHydrationWarning><span>{brandFeed.brands.join(" · ")}{brandFeed.totalBrands > brandFeed.brands.length ? ` · ${brandFeed.brands.length} of ${brandFeed.totalBrands} today, the rest take turns` : ""}{brandFeed.lastFetchedAt ? ` · checked ${ago(brandFeed.lastFetchedAt)}` : ""}</span>{forMe ? <Link href="/profile/brands" className="pill pill-sm" data-testid="brand-feed-add">+ Add brand</Link> : null}</p> : null}
        {brandFeed.lastError && !feedBusy ? <p className="note mt-2 text-ink" role="status" data-testid="brand-feed-error">{brandFeed.lastError}</p> : null}
        {!brandFeed.brands.length ? (
          <div className="card mt-3 p-4" data-testid="brand-feed-none">
            <p className="note text-ink text-[16px]">{forPersonId === meId ? "Pick the brands you love and the Shop shows what’s new from them, every day." : `When ${forName} picks favorite brands in their Profile, what’s new from them shows here every day.`}</p>
            {forPersonId === meId ? <Link href="/profile/brands" className="pill pill-solid mt-3" data-testid="brand-feed-pick">Pick my brands</Link> : null}
          </div>
        ) : brandFeed.products.length ? (
          <div className="strip -mx-5 mt-3 snap-x scroll-px-5 gap-2.5 px-5 pb-2 lg:mx-0 lg:grid lg:grid-cols-3 lg:scroll-px-0 lg:px-0">
            {brandFeed.products.map((p) => <ProductCard key={p.url} p={p} isNew={p.isNew} onJudge={() => judge(p.url)} judging={thinking} personId={forPersonId} category={null} testId="brand-feed-product" judgeTestId="brand-feed-judge" lookTestId="brand-feed-add-look" />)}
          </div>
        ) : feedBusy || brandFeed.lastError ? null : <p className="note mt-3" data-testid="brand-feed-empty">Nothing from these brands in the stores right now. Refresh to look again.</p>}
      </section>

      </div>

      <Sheet open={onMe !== null} onClose={() => setOnMe(null)} title={onMe?.mannequin ? "On a mannequin" : forMe ? "On you" : `On ${forName}`}>
        {onMe ? (
          <div className="flex flex-col gap-3" data-testid="see-it-on-me-sheet">
            <div className="stage h-[460px] overflow-hidden"><img src={`/api/photo/${onMe.key}`} alt={onMe.mannequin ? "This piece on a mannequin" : "You wearing this piece"} className="size-full object-contain" /></div>
            <p className="caption">{onMe.mannequin ? "No body photo used" : forMe ? "Only you can see this picture" : `Only ${forName} and you can see this picture`}{onMe.cached ? " · saved from before" : ""}</p>
          </div>
        ) : null}
      </Sheet>
      <Sheet open={compare !== null} onClose={() => setCompare(null)} title="Side by side">
        {compare && selected ? (
          <div data-testid="compare-sheet">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="stage h-[260px] overflow-hidden">{selected.imageKey ? <img src={`/api/photo/${selected.imageKey}`} alt={selected.title ?? "The new piece"} className="size-full object-cover" /> : null}</div>
                <p className="caption mt-2">New</p>
                <p className="truncate text-[15px] font-medium">{selected.title ?? "New piece"}</p>
              </div>
              <div>
                <div className="stage h-[260px] overflow-hidden">{compare.thumbKey ? <img src={`/api/photo/${compare.thumbKey}`} alt={compare.name} className="size-full object-cover" /> : null}</div>
                <p className="caption mt-2">Yours</p>
                <p className="truncate text-[15px] font-medium">{compare.name}</p>
              </div>
            </div>
            <Link href={`/closet/${compare.id}`} className="pill mt-4 h-[50px] w-full">Open yours in the closet</Link>
          </div>
        ) : null}
      </Sheet>
      <Sheet open={sheet === "for"} onClose={() => setSheet(null)} title="Shopping for">
        <div className="flex flex-col" role="listbox">
          {people.map((p) => <button key={p.id} type="button" role="option" aria-selected={p.id === forPersonId} onClick={() => { setSheet(null); start(async () => { await rememberShopForAction(p.id); router.push(`/shop?for=${p.id}`); }); }} className="tap flex h-12 w-full items-center justify-between rounded-xl px-2 text-[15px]"><span>{p.id === meId ? `${p.name} (me)` : p.name}</span><span className={cn("mono", p.id === forPersonId ? "text-ink" : "text-transparent")}>✓</span></button>)}
        </div>
        <p className="note mt-4">You can shop for yourself, your kids, and anyone who allowed it in their Settings. The pick is remembered.</p>
      </Sheet>
      <TextSheet open={sheet === "link"} onClose={() => setSheet(null)} title="Paste a link" label="Store link" kind="url" submitLabel="Judge it" value="" placeholder="https://www.everlane.com/products/…" onSave={(v) => judge(v)} />
    </div>
  );
}

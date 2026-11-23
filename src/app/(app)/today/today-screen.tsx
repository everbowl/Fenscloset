"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { Suspense, use, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Cloud, CloudRain, CloudSun, Snowflake, Sun, Users, Sparkles, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Sheet } from "@/components/ui/sheet";
import { TextSheet } from "@/components/items/row-editor";
import { cn } from "@/lib/cn";
import type { BoardView, Piece } from "@/lib/outfits/engine";
import type { Scale } from "@/lib/checkins/service";
import type { TryOnState } from "@/lib/tryon";
import type { Wardrobe } from "@/lib/tryon/complete";
import type { Engine } from "@/lib/tryon/engines";
import { MirrorGlyph, MirrorSheet } from "@/components/mirror/mirror-sheet";
import { useMirror } from "@/components/mirror/use-mirror";
import { checkInSelfieAction, checkInTapsAction, looksStatusAction, moreAction, rateAction, regenerateAction, removeAction, setLocationAction, setPlanAction, setZipAction, swapAction, wearAction, type LooksResult } from "./actions";
import { RatingRow } from "../fits/rating-row";
import { deleteFitAction } from "../fits/actions";
import { InlineAdd } from "@/components/lists/inline-add";
import { monoDate } from "@/lib/dates";

/** What the weather cell shows: the forecast, or why there is none (nothing saved yet, or the lookup failed). */
export type WeatherView = { weather: { condition: string; source: string; nowF: number; tonightF: number; highF: number; lowF: number; rainChance: number } | null; note: "none" | "failed" | null };

/** One day of the week strip: the last six days and today, with the fit worn that day when there is one. */
export type WeekDay = { key: string; weekday: string; day: number; today: boolean; thumbKey: string | null; fitId: string | null };

type Props = {
  personId: string; personName: string; mine: boolean; canDress: boolean; isAdmin: boolean;
  date: string; evening: boolean; hour: number; contextLine: string; dateLabel: string;
  /** The forecast: a promise while it is on its way (the chip breathes, the rest of the page is already there), a plain answer when there is nowhere to ask about. */
  weather: WeatherView | Promise<WeatherView>; savedZip: string | null;
  week: WeekDay[];
  plan: { source: string; label: string | null; occasionId: string | null }; calendarConnected: boolean; calendarConfigured: boolean;
  checkIn: { source: "taps" | "selfie"; answers: { scaleId: string; optionId: string }[] } | null; scales: Scale[];
  occasions: { id: string; name: string }[];
  suggestion: { id: string; boards: BoardView[]; wornIndex: number | null } | null;
  /** No looks for today yet: the screen asks for them in the background as soon as it opens. */
  needsLooks: boolean;
  enoughClothes: boolean; cleanOutCount: number;
  /** New matches waiting on the person's Looking-for list (Shop v2 item 2); 0 keeps Today quiet. */
  lookingForNew: number;
  /** The most recent fit (last 7 days) with no "how did it go?" answer yet. */
  unrated: { id: string; date: string; title: string } | null;
  /** Whether TRY IT ON is offered: ready, or why not (off → Settings link; no_photo → Body page link). Hidden for minors and others' closets. */
  tryOn: TryOnState;
  /** SEE IT ON falls back to the shared mannequin (no body photo needed; minors and parents too) when the person's own try-on is not ready. */
  mannequin: boolean;
  /** A back body photo exists: the mirror can show the look from behind. */
  backPhoto: boolean;
  /** The mannequin is set up: offered in the mirror even when the person has their own photo. */
  mannequinAvailable: boolean;
  /** The person's placeable pieces, for the mirror's "To go with it" rows. */
  wardrobe: Wardrobe;
  /** Who dresses on the person's photo (FASHN can't place shoes). */
  engine: Engine;
};

/** "Tops" from "TOPS": the engine's labels arrive shouted; the screen reads them in sentence case. */
const sentence = (s: string) => s.length ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
/** "Saturday, Nov 21" from the mono date "SAT, NOV 21". */
function longDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Today (screen 04, v2): greeting and weather, the week, the look as a flat-lay, one colored button, the mirror, the rest as small cards. */
export function TodayScreen(p: Props) {
  const router = useRouter();
  const [, start] = useTransition();
  // No looks yet: the screen opens already building (the build starts below), never on an error it has not had.
  const [busy, setBusy] = useState<string | null>(p.needsLooks ? "regen" : null);
  const setError = (e?: string) => { if (e) toast.error(e); };
  const [sheet, setSheet] = useState<"checkin" | "plan" | "planText" | "swap" | "zip" | null>(null);
  const [index, setIndex] = useState(Math.max(0, p.suggestion?.wornIndex ?? 0));
  const scroller = useRef<HTMLDivElement>(null);
  const boards = p.suggestion?.boards ?? [];
  const board = boards[index] ?? null;
  // The mirror: dressed in the background, polled, shown in the shared sheet (src/components/mirror).
  const m = useMirror(p.personId, p.wardrobe, p.engine);

  function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(undefined); setBusy(label);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) setError(r.error); else after?.();
      router.refresh();
    });
  }

  // Looks are built in the background and polled (20 to 40 seconds of Claude); the screen stays usable and a phone
  // that gives up on a long request has nothing to give up on.
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Each build gets a number; a poll from an older build (a check-in saved while the first looks were building) is dropped.
  const build = useRef(0);
  useEffect(() => () => { if (poll.current) clearTimeout(poll.current); }, []);
  function newBuild(): number {
    if (poll.current) { clearTimeout(poll.current); poll.current = null; }
    return ++build.current;
  }
  function looksDone(r: LooksResult, n: number, after?: () => void) {
    if (n !== build.current) return; // a newer build took over
    if (!r.ok) { setBusy(null); setError(r.error); router.refresh(); return; }
    if (r.pending) {
      const { jobId } = r.pending;
      poll.current = setTimeout(async () => {
        let next: LooksResult;
        try { next = await looksStatusAction(jobId); } catch { next = r; } // a dropped poll (phone asleep): ask again
        looksDone(next, n, after);
      }, 2000);
      return;
    }
    setBusy(null); after?.(); router.refresh();
  }
  function buildLooks(label: string, fn: () => Promise<LooksResult>, after?: () => void) {
    const n = newBuild();
    setError(undefined); setBusy(label);
    start(async () => {
      let r: LooksResult;
      try { r = await fn(); } catch { r = { ok: false, error: "Couldn’t build the looks. Try again." }; }
      looksDone(r, n, after);
    });
  }
  /** No looks for today yet: ask for them the moment the screen opens. */
  const asked = useRef(false);
  useEffect(() => {
    if (!p.needsLooks || asked.current) return;
    asked.current = true;
    buildLooks("regen", () => regenerateAction(p.personId));
  }, [p.needsLooks]); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * Save a check-in or plan (quick), close the sheet, then ask for fresh looks while the screen stays usable.
   * Allowed while looks are already building: the build running is followed by a fresh one that knows the new input.
   */
  function saveThenRefresh(fn: () => Promise<{ ok: boolean; error?: string }>) {
    const n = newBuild();
    setSheet(null); setError(undefined); setBusy("regen");
    start(async () => {
      const saved = await fn();
      if (!saved.ok) { if (n === build.current) { setBusy(null); setError(saved.error); } router.refresh(); return; }
      router.refresh();
      let r: LooksResult;
      try { r = await regenerateAction(p.personId, true); } catch { r = { ok: false, error: "Couldn’t build the looks. Try again." }; }
      looksDone(r, n, () => setIndex(0));
    });
  }

  // The board under the person's eyes drives the dots and the text: each board reports when it is (mostly) in view.
  const indexRef = useRef(index);
  indexRef.current = index;
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const i = Number((e.target as HTMLElement).dataset.index);
        if (Number.isFinite(i) && i !== indexRef.current) setIndex(i);
      }
    }, { root: el, threshold: 0.6 });
    el.querySelectorAll<HTMLElement>("[data-index]").forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [boards.length]);
  const goTo = (i: number) => {
    const el = scroller.current;
    const child = el?.querySelector<HTMLElement>(`[data-index="${i}"]`);
    if (el && child) el.scrollTo({ left: child.offsetLeft - (el.clientWidth - child.clientWidth) / 2, behavior: "instant" as ScrollBehavior });
    setIndex(i);
  };
  // After every refresh (new suggestion object) keep the strip on the board the person is looking at.
  useEffect(() => { if (boards.length) goTo(Math.min(indexRef.current, boards.length - 1)); }, [p.suggestion, boards.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function askLocation() {
    if (!("geolocation" in navigator)) { setSheet("zip"); return; }
    setBusy("location");
    navigator.geolocation.getCurrentPosition(
      (pos) => run("location", () => setLocationAction(pos.coords.latitude, pos.coords.longitude)),
      () => { setBusy(null); setSheet("zip"); },
      { timeout: 8000, maximumAge: 600000 },
    );
  }

  // Seconds since the build started, for the wait card; after ~90s say so and offer Try again.
  const [buildStartedAt, setBuildStartedAt] = useState<number | null>(p.needsLooks ? Date.now() : null);
  const [buildSecs, setBuildSecs] = useState(0);
  useEffect(() => {
    if (busy !== "regen" && busy !== "more") { setBuildStartedAt(null); setBuildSecs(0); return; }
    setBuildStartedAt((t) => t ?? Date.now());
  }, [busy]);
  useEffect(() => {
    if (buildStartedAt === null) return;
    const tick = () => setBuildSecs(Math.max(0, Math.floor((Date.now() - buildStartedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [buildStartedAt]);
  const slow = buildSecs >= 90;
  const whose = p.mine ? "your" : `${p.personName}’s`;
  const worn = Boolean(board?.wornFitId);
  const [flashWorn, setFlashWorn] = useState(false); // "✓ Worn" for a beat before the button turns into the Fits link
  const building = busy === "regen" || busy === "more";
  const greeting = p.mine ? `${p.hour < 5 ? "Up late" : p.hour < 12 ? "Good morning" : p.hour < 17 ? "Good afternoon" : "Good evening"}, ${p.personName}` : `${p.personName}’s ${p.evening ? "evening" : "day"}`;
  const planLabel = p.plan.label ?? "Everyday";
  const checkInLabel = p.checkIn ? (p.checkIn.source === "selfie" ? "Checked in · selfie" : "Checked in") : "Check in";

  return (
    <div data-testid="today" className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-14">
      {/* Greeting on the left, the weather beside it. The weather streams in after the page paints. */}
      <div className="flex items-start justify-between gap-3 lg:col-start-2">
        <div className="min-w-0">
          <h1 className="serif text-[32px] leading-none" data-testid="greeting">{greeting}</h1>
          <p className="caption mt-2" data-testid="weather-date">{longDate(p.date)}<span className="sr-only"> · {p.dateLabel}</span></p>
        </div>
        <Suspense fallback={<WeatherChipPending />}>
          <WeatherArea weather={p.weather} canDress={p.canDress} savedZip={p.savedZip} finding={busy === "location"} onZip={() => setSheet("zip")} onLocation={askLocation} />
        </Suspense>
      </div>

      <WeekStrip days={p.week} className="mt-3 lg:col-start-2" />

      {/* Today's suggestions: the plan on the left, the check-in on the right; tap either to change it. */}
      <div className="mt-4 flex items-center justify-between gap-2 lg:col-start-2" data-testid="context-line">
        <span className="sr-only">{p.contextLine}</span>
        {p.canDress ? (
          <>
            <button type="button" onClick={() => setSheet("plan")} className="tap -ml-1 flex min-h-11 min-w-0 items-center gap-1 rounded-full px-1 text-[20px] font-semibold" data-testid="edit-plan">
              <span className="truncate">{planLabel}</span><ChevronDown className="size-4 shrink-0 text-graphite" strokeWidth={2.5} />
            </button>
            <button type="button" onClick={() => setSheet("checkin")} className={cn("pill pill-sm shrink-0", p.checkIn && "pill-on")} data-testid="check-in">{checkInLabel}</button>
          </>
        ) : (
          <span className="text-[20px] font-semibold">{planLabel}</span>
        )}
      </div>

      {boards.length ? (
        <>
          <div className="relative mt-3 lg:col-start-1 lg:row-start-1 lg:row-span-3 lg:mt-0">
            <div ref={scroller} tabIndex={0} aria-label="Looks" onKeyDown={(e) => { if (e.key === "ArrowRight" && index < boards.length - 1) goTo(index + 1); if (e.key === "ArrowLeft" && index > 0) goTo(index - 1); }} className="strip -mx-5 snap-x snap-mandatory outline-none focus-visible:outline-2 focus-visible:outline-ink lg:mx-0">
              {boards.map((b, i) => <Board key={i} index={i} board={b} active={i === index} dim={building} />)}
            </div>
          </div>
          {/* Dots say where you are; the arrows are for a keyboard and a desktop. */}
          {boards.length > 1 ? (
            <div className="mt-3 flex items-center justify-center gap-4 lg:col-start-1 lg:row-start-4" data-testid="board-pager">
              <button type="button" aria-label="Previous look" disabled={index === 0} onClick={() => goTo(index - 1)} className="pill pill-sm px-3 disabled:opacity-30">‹</button>
              <span className="flex items-center gap-2" aria-hidden>
                {boards.map((_, i) => <span key={i} className={cn("block size-2 rounded-full transition-colors", i === index ? "bg-ink" : "bg-line")} />)}
              </span>
              <span className="sr-only">{index + 1} of {boards.length}</span>
              <button type="button" aria-label="Next look" disabled={index >= boards.length - 1} onClick={() => goTo(index + 1)} className="pill pill-sm px-3 disabled:opacity-30">›</button>
            </div>
          ) : null}
          {board ? (
            <div className="mt-3 flex flex-col gap-1.5 lg:col-start-2 lg:mt-0">
              <p className="caption" data-testid="piece-list">{board.pieces.map((x) => sentence(x.label)).join(" · ")}</p>
              <p className="text-[17px] leading-snug" data-testid="reason">{board.reason}</p>
              {board.why ? <WhyList why={board.why} /> : null}
            </div>
          ) : null}
          {p.canDress ? (
            <div className="mt-4 flex flex-col gap-2 lg:col-start-2">
              {worn && !flashWorn ? (
                <div className="card flex min-h-[60px] items-center justify-between gap-3 px-4 py-3" data-testid="wearing-this">
                  <span className="flex min-w-0 flex-col"><span className="text-[16px] font-semibold">✓ Wearing this</span><span className="caption">On {whose} Fits calendar</span></span>
                  <span className="flex shrink-0 gap-1.5">
                    <Link href="/fits" className="pill pill-sm" data-testid="see-fits">See Fits</Link>
                    <button type="button" disabled={busy !== null} onClick={() => run("unwear", () => deleteFitAction(board!.wornFitId!))} className="pill pill-sm pill-quiet" data-testid="unwear">Undo</button>
                  </span>
                </div>
              ) : (
                <Button size="lg" className="w-full" sub={`Lands on ${whose} Fits calendar`} flash={flashWorn ? "✓ Worn" : null} busy={busy === "wear"} disabled={busy !== null}
                  onClick={() => run("wear", () => wearAction(p.personId, p.suggestion!.id, index), () => { setFlashWorn(true); setTimeout(() => setFlashWorn(false), 900); })} data-testid="wear-this">{busy === "wear" ? "Saving…" : "Wear this"}</Button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" disabled={busy !== null || worn} onClick={() => setSheet("swap")} data-testid="swap">Change a piece</Button>
                <Button variant="outline" busy={busy === "more"} disabled={busy !== null} onClick={() => { const next = boards.length; buildLooks("more", () => moreAction(p.personId), () => setIndex(next)); }} data-testid="more-looks">{busy === "more" ? "Thinking…" : "More looks"}</Button>
              </div>
            </div>
          ) : null}
          {p.canDress && (p.tryOn === "ready" || p.mannequin) ? (
            <div className="mt-4 lg:col-start-1 lg:row-start-5 lg:row-span-4 lg:self-start" data-testid="mirror">
              <button type="button" disabled={busy !== null} onClick={() => m.show({ look: { kind: "today", suggestionId: p.suggestion!.id, index }, on: p.tryOn === "ready" ? "me" : "mannequin" })}
                className="card tap flex w-full items-center gap-4 p-3 text-left disabled:opacity-60" data-testid={p.tryOn === "ready" ? "try-on" : "see-on-mannequin"}>
                <span className="stage relative h-[132px] w-[96px] shrink-0 overflow-hidden rounded-xl">
                  {m.tryOn ? <img src={`/api/photo/${m.tryOn.key}`} alt="" className="size-full object-cover" /> : <span className="flex size-full items-center justify-center p-3"><MirrorGlyph /></span>}
                  {m.busy ? <span className="absolute inset-0 flex items-center justify-center bg-paper/60"><span className="size-2.5 animate-pulse rounded-full bg-ink" /></span> : null}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[17px] font-semibold">{m.busy ? "Dressing you…" : p.tryOn === "ready" ? "See it on you" : "See it on a mannequin"}</span>
                  <span className="note">{p.tryOn === "ready" ? "This look, on your photo." : `This look on the mannequin${p.mine ? "" : ` for ${p.personName}`}.`}</span>
                  <span className="caption text-ink">Tap to open the mirror ›</span>
                </span>
              </button>
              {p.tryOn === "off" ? (
                <Link href="/profile/settings" className="tap mt-2 flex min-h-11 items-center justify-between gap-3 rounded-xl px-1 text-[15px]" data-testid="try-on-off"><span>Want the mirror to show you? Turn on try-on</span><span aria-hidden className="text-graphite">›</span></Link>
              ) : p.tryOn === "no_photo" ? (
                <Link href="/profile/body" className="tap mt-2 flex min-h-11 items-center justify-between gap-3 rounded-xl px-1 text-[15px]" data-testid="try-on-photo"><span>Want the mirror to show you? Add a body photo</span><span aria-hidden className="text-graphite">›</span></Link>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {/* Before the first looks: a look's shape on the stage, breathing while they build. */}
          <div className={cn("stage relative mt-3 aspect-square w-full overflow-hidden lg:col-start-1 lg:row-start-1 lg:row-span-6 lg:mt-0 lg:aspect-[4/5]", building && "animate-pulse")} aria-hidden>
            <span className="absolute left-[24%] top-[6%] h-[44%] w-[52%] rounded-2xl bg-paper/70" />
            <span className="absolute left-[26%] top-[48%] h-[44%] w-[48%] rounded-2xl bg-paper/70" />
            <span className="absolute left-[64%] top-[70%] h-[18%] w-[30%] rounded-2xl bg-paper/70" />
            {building ? <span className="absolute inset-x-0 bottom-5 text-center text-[15px] font-medium text-graphite">Considering the weather…</span> : null}
          </div>
          <div className="mt-3 flex flex-col gap-2 lg:col-start-2 lg:mt-0">
            {!building ? (
              <>
                <p className="section">No looks yet</p>
                <p className="note">{p.enoughClothes ? (p.canDress ? "Something went wrong building today’s looks." : `${p.personName} hasn’t opened Today yet.`) : p.mine ? "Add clothes with the + button and your first three looks will appear here." : `${p.personName}’s closet needs a few more pieces first.`}</p>
                {!p.enoughClothes && p.mine ? <Link href="/add" className="pill mt-2 self-start" data-testid="empty-add-clothes">+ Add clothes</Link> : null}
                {p.enoughClothes && p.canDress ? <Button variant="secondary" className="mt-2 w-full" disabled={busy !== null} onClick={() => buildLooks("regen", () => regenerateAction(p.personId))}>Try again</Button> : null}
              </>
            ) : null}
          </div>
        </>
      )}

      {p.unrated ? (
        <div className="card mt-4 px-4 py-3 lg:col-start-2" data-testid="yesterday-strip">
          <p className="caption">{monoDate(p.unrated.date)} · {p.unrated.title}</p>
          <RatingRow compact rating={null} disabled={busy !== null} onRate={(r) => { if (r) run("rate", () => rateAction(p.unrated!.id, r)); }} />
        </div>
      ) : null}

      {/* Together, Looking for, Clean-out: small cards in a row. */}
      <div className="mt-4 grid grid-cols-3 gap-2 lg:col-start-2">
        <SmallCard href="/today/together" icon={<Users className="size-5" strokeWidth={1.8} />} title="Together" sub="Dress two or more" testId="together-link" />
        {p.lookingForNew > 0 ? <SmallCard href={`/shop/looking-for?for=${p.personId}`} icon={<Sparkles className="size-5" strokeWidth={1.8} />} title="Looking for" sub={`${p.lookingForNew} new ${p.lookingForNew === 1 ? "match" : "matches"}`} testId="looking-for-strip" /> : null}
        {p.cleanOutCount > 0 && p.canDress ? <SmallCard href="/closet/clean-out?from=today" icon={<Archive className="size-5" strokeWidth={1.8} />} title="Clean-out" sub={`${p.cleanOutCount} not worn in a while`} testId="clean-out-link" /> : null}
      </div>

      <Suspense fallback={null}><WeatherCredit weather={p.weather} /></Suspense>

      {/* The wait card: what is happening, how long it usually takes, and that you can leave. */}
      {building ? (
        <div className="wait flex items-center gap-3" role="status" aria-live="polite" data-testid="refreshing">
          <span aria-hidden className="size-2.5 shrink-0 animate-pulse rounded-full bg-paper" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-semibold">{slow ? "Taking longer than usual" : busy === "more" ? "Finding more looks" : `Building ${p.evening ? "tonight’s" : "today’s"} looks`}<span className="font-normal opacity-70"> · {buildSecs}s</span></span>
            <span className="text-[13px] opacity-80">Usually about 30 seconds. You can leave; they’ll be here.</span>
          </span>
          {slow ? <button type="button" onClick={() => buildLooks("regen", () => regenerateAction(p.personId))} className="pill pill-sm shrink-0 bg-paper text-ink" data-testid="build-retry">Try again</button> : null}
        </div>
      ) : null}

      {/* Check-in: taps on each scale, or a selfie read by Claude. */}
      <CheckInSheet open={sheet === "checkin"} onClose={() => setSheet(null)} scales={p.scales} current={p.checkIn} busy={busy} isAdmin={p.isAdmin} mine={p.mine} personName={p.personName}
        onTaps={(answers) => saveThenRefresh(() => checkInTapsAction(p.personId, answers))}
        onSelfie={(file) => { const fd = new FormData(); fd.set("selfie", file); saveThenRefresh(() => checkInSelfieAction(p.personId, fd)); }} />

      {/* Plan: the occasion list (admins add right here), free text, or back to the calendar. */}
      <Sheet open={sheet === "plan"} onClose={() => setSheet(null)} title="Today’s plan">
        <p className="note mb-3">{p.plan.source === "calendar" ? `From your calendar: ${p.plan.label}` : p.plan.source === "pick" ? `Picked: ${p.plan.label}` : p.calendarConnected ? "Nothing on your calendar today" : p.calendarConfigured ? <>Pick a plan, or <Link href="/profile/settings" className="text-ink underline">connect your calendar</Link>.</> : "Pick a plan for today."}</p>
        <PlanPicker occasions={p.occasions} selected={p.plan.occasionId} isAdmin={p.isAdmin} busy={busy !== null && busy !== "regen"}
          onPick={(id) => saveThenRefresh(() => setPlanAction(p.personId, { occasionId: id }))}
          onText={() => setSheet("planText")}
          onClear={p.plan.source === "pick" ? () => saveThenRefresh(() => setPlanAction(p.personId, null)) : undefined} />
      </Sheet>
      <TextSheet open={sheet === "planText"} onClose={() => setSheet(null)} title="What’s the plan?" label="Plan" value={p.plan.source === "pick" && !p.plan.occasionId ? p.plan.label ?? "" : ""} placeholder="Dinner with the Smiths" onSave={(v) => saveThenRefresh(() => setPlanAction(p.personId, { text: v }))} />

      {/* Swap: tap the piece to replace. */}
      <Sheet open={sheet === "swap"} onClose={() => setSheet(null)} title="Change a piece">
        <p className="note mb-2">Swap it for another, or take it off the look.</p>
        <div className="flex flex-col">
          {board?.pieces.map((x) => (
            <div key={x.id} className="flex h-14 items-center gap-3 border-b border-line">
              <span className="stage size-10 shrink-0 overflow-hidden rounded-lg">{x.thumbKey ? <img src={`/api/photo/${x.thumbKey}`} alt="" className="size-full object-contain" /> : null}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[16px]">{x.name}</span><span className="caption">{sentence(x.label)}</span></span>
              <button type="button" disabled={busy !== null} onClick={() => run("swap", () => swapAction(p.personId, index, x.id), () => setSheet(null))} className="pill pill-sm" data-testid={`swap-${x.id}`}>Swap</button>
              {(board?.pieces.length ?? 0) > 2 ? <button type="button" disabled={busy !== null} onClick={() => run("swap", () => removeAction(p.personId, index, x.id), () => setSheet(null))} className="pill pill-sm pill-quiet" data-testid={`remove-${x.id}`}>Remove</button> : null}
            </div>
          ))}
        </div>
        {busy === "swap" ? <p className="note mt-3">Thinking…</p> : null}
      </Sheet>

      {/* See it on: the look on your own body photo (yours alone), or on the shared mannequin (no body in it). */}
      <MirrorSheet m={m} pieces={board?.pieces.map((x) => sentence(x.label)).join(" · ") ?? ""} mine={p.mine} personId={p.personId} personName={p.personName} tryOnState={p.tryOn} backPhoto={p.backPhoto} mannequinAvailable={p.mannequinAvailable} admin={p.isAdmin} />

      <TextSheet open={sheet === "zip"} onClose={() => setSheet(null)} title="Weather for your zip" label="Zip code" kind="zip" value={p.savedZip ?? ""} placeholder="92101" onSave={(v) => run("zip", () => setZipAction(v))} />
    </div>
  );
}

/** A small card in the row under the look: an icon, a title, one line, a chevron. */
function SmallCard({ href, icon, title, sub, testId }: { href: string; icon: React.ReactNode; title: string; sub: string; testId: string }) {
  return (
    <Link href={href} className="card tap flex min-h-[96px] flex-col justify-between rounded-2xl p-3" data-testid={testId}>
      <span className="text-ink">{icon}</span>
      <span className="flex flex-col"><span className="text-[15px] font-semibold leading-tight">{title}</span><span className="caption leading-tight">{sub}</span></span>
    </Link>
  );
}

/** The last six days and today: a worn fit shows as its picture, today is the filled dot, each day opens Fits. */
function WeekStrip({ days, className }: { days: WeekDay[]; className?: string }) {
  if (!days.length) return null;
  return (
    <div className={cn("grid grid-cols-7 gap-1", className)} data-testid="week-strip" aria-label="This week">
      {days.map((d) => (
        <Link key={d.key} href={d.fitId ? `/fits/${d.fitId}` : "/fits"} className="flex flex-col items-center gap-1.5" aria-label={`${d.weekday} ${d.day}${d.fitId ? ", worn" : ""}`} aria-current={d.today ? "date" : undefined}>
          <span className={cn("text-[11px] font-medium", d.today ? "text-ink" : "text-graphite")}>{d.weekday}</span>
          <span className={cn("flex size-8 items-center justify-center overflow-hidden rounded-full text-[13px] font-semibold", d.today ? "bg-ink text-paper" : d.thumbKey ? "bg-bone" : "bg-paper text-graphite ring-1 ring-inset ring-line")}>
            {d.thumbKey && !d.today ? <img src={`/api/photo/${d.thumbKey}`} alt="" className="size-full object-cover" /> : d.day}
          </span>
        </Link>
      ))}
    </div>
  );
}

function isThenable<T>(v: T | Promise<T>): v is Promise<T> { return typeof (v as Promise<T> | null)?.then === "function"; }

/** The forecast may still be on its way: `use` waits for it inside the Suspense boundary; a plain answer is read as it is. */
function useWeather(w: WeatherView | Promise<WeatherView>): WeatherView {
  return isThenable(w) ? use(w) : w;
}

function WeatherIcon({ condition, className }: { condition: string; className?: string }) {
  const c = condition.toLowerCase();
  const props = { className, strokeWidth: 1.8, "aria-hidden": true as const };
  if (c.includes("snow")) return <Snowflake {...props} />;
  if (c.includes("rain") || c.includes("drizzle") || c.includes("shower") || c.includes("thunder")) return <CloudRain {...props} />;
  if (c.includes("partly")) return <CloudSun {...props} />;
  if (c.includes("cloud") || c.includes("fog")) return <Cloud {...props} />;
  return <Sun {...props} />;
}

type WeatherAreaProps = { weather: WeatherView | Promise<WeatherView>; canDress: boolean; savedZip: string | null; finding: boolean; onZip: () => void; onLocation: () => void };

/** The weather chip beside the greeting: the number now, the condition and tonight under it. With no forecast, the way to get one. */
function WeatherArea({ weather, canDress, savedZip, finding, onZip, onLocation }: WeatherAreaProps) {
  const { weather: w, note } = useWeather(weather);
  if (w) {
    const inner = (
      <>
        <WeatherIcon condition={w.condition} className="size-6 shrink-0" />
        <span className="flex flex-col items-start leading-tight">
          <span className="text-[22px] font-semibold leading-none">{w.nowF}°</span>
          <span className="caption whitespace-nowrap">{w.condition} · {w.tonightF}° tonight</span>
          <span className="caption whitespace-nowrap">H {w.highF}° · L {w.lowF}°{w.rainChance >= 20 ? ` · Rain ${w.rainChance}%` : ""}</span>
        </span>
      </>
    );
    const cls = "flex shrink-0 items-center gap-2 rounded-2xl py-1 pl-1 pr-2 text-left";
    return canDress
      ? <button type="button" onClick={onZip} className={cn(cls, "tap")} data-testid="weather-block" aria-label={`Weather ${w.nowF} degrees, ${w.condition}. Change zip`}>{inner}</button>
      : <div className={cls} data-testid="weather-block">{inner}</div>;
  }
  if (!canDress) return null;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5" data-testid="weather-note">
      <span className="caption text-right">{note === "failed" ? "Weather didn’t load" : "Where are you today?"}</span>
      <span className="flex gap-1.5">
        {note === "none" ? <button type="button" onClick={onLocation} disabled={finding} className="pill pill-sm">{finding ? "Finding…" : "Use my location"}</button> : null}
        <button type="button" onClick={onZip} className="pill pill-sm" data-testid="enter-zip">{savedZip ? "Change zip" : "Enter zip"}</button>
      </span>
    </div>
  );
}

/** The chip's shape while the forecast is on its way. */
function WeatherChipPending() {
  return (
    <div className="flex shrink-0 animate-pulse items-center gap-2 py-1 pr-2" data-testid="weather-pending" aria-busy="true" aria-label="Getting the weather">
      <span className="size-6 rounded-full bg-bone" />
      <span className="flex flex-col gap-1.5"><span className="h-5 w-10 rounded bg-bone" /><span className="h-3 w-24 rounded bg-bone" /><span className="h-3 w-16 rounded bg-bone" /></span>
    </div>
  );
}

/** The source line at the foot of the page, once there is a forecast to credit. */
function WeatherCredit({ weather }: { weather: WeatherView | Promise<WeatherView> }) {
  return useWeather(weather).weather ? <p className="caption mt-5 lg:col-start-2">Weather by Open-Meteo</p> : null;
}

/** Where a piece sits on the stage: outer layer, top or dress, bottom, shoes; anything else (bags, hats, jewelry) is an accessory. */
const STACK: Record<string, number> = { Outerwear: 0, Tops: 1, Activewear: 1, Dresses: 1, Swimwear: 1, Sleepwear: 1, Bottoms: 2, Shoes: 3 };
function slotOf(p: Piece): number { return p.category && p.category in STACK ? STACK[p.category] : 4; }

/**
 * The look laid out on the stage like clothes on a bed (Alta's and Whering's flat-lays, docs/redesign-2026-11-23.md): the top
 * up, the bottom under it, shoes low on the right, an outer layer up on the right, accessories low on the left. Positions are
 * shares of the stage, so the same look reads the same on every phone.
 */
type Spot = { left: number; top: number; width: number; height: number };
function layout(pieces: Piece[]): { piece: Piece; spot: Spot }[] {
  const by = (slot: number) => pieces.filter((p) => slotOf(p) === slot);
  const outer = by(0)[0], top = by(1)[0], bottom = by(2)[0], shoes = by(3)[0];
  const extras = [...by(0).slice(1), ...by(1).slice(1), ...by(2).slice(1), ...by(3).slice(1), ...by(4)];
  const out: { piece: Piece; spot: Spot }[] = [];
  const hasOuter = Boolean(outer);
  if (top) out.push({ piece: top, spot: { left: hasOuter ? 6 : 22, top: 4, width: 54, height: 46 } });
  if (outer) out.push({ piece: outer, spot: { left: 54, top: 8, width: 42, height: 44 } });
  if (bottom) out.push({ piece: bottom, spot: { left: top ? 24 : 26, top: top ? 44 : 10, width: 48, height: top ? 52 : 70 } });
  if (shoes) out.push({ piece: shoes, spot: { left: 66, top: 70, width: 30, height: 24 } });
  extras.slice(0, 3).forEach((p, i) => out.push({ piece: p, spot: { left: 4, top: 54 + i * 15, width: 20, height: 14 } }));
  return out;
}

function Board({ board, index, active, dim }: { board: BoardView; index: number; active: boolean; dim: boolean }) {
  const n = board.pieces.length;
  const placed = layout(board.pieces);
  const single = n === 1 ? board.pieces[0] : null;
  return (
    <div className="w-[92%] shrink-0 snap-center px-5 first:ml-[4%] last:mr-[4%] lg:w-full lg:px-0 lg:first:ml-0 lg:last:mr-0" aria-hidden={!active} data-testid="board" data-index={index} data-pieces={n}>
      <div className={cn("stage relative aspect-square w-full overflow-hidden transition-opacity lg:aspect-[4/5]", dim && "opacity-50")} data-testid="outfit-stack">
        {single ? (
          single.thumbKey ? <img src={`/api/photo/${single.thumbKey}`} alt={single.name} className="absolute inset-[8%] size-[84%] object-contain" loading={active ? "eager" : "lazy"} decoding="async" /> : <span className="absolute inset-0 flex items-center justify-center p-6 text-center text-[16px]">{single.name}</span>
        ) : placed.map(({ piece, spot }) => (
          <span key={piece.id} className="absolute" style={{ left: `${spot.left}%`, top: `${spot.top}%`, width: `${spot.width}%`, height: `${spot.height}%` }}>
            {piece.thumbKey ? <img src={`/api/photo/${piece.thumbKey}`} alt={piece.name} className="size-full object-contain" loading={active ? "eager" : "lazy"} decoding="async" /> : <span className="flex size-full items-center justify-center rounded-xl bg-paper/70 p-2 text-center text-[12px] leading-tight">{piece.name}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Plain lines under the sentence: weather by name with the numbers, then dress code, color, and what the person reaches for. */
function WhyList({ why }: { why: NonNullable<BoardView["why"]> }) {
  // Folded on a phone, open on a desktop (A1): the sentence is the reason; this is the receipt.
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(window.matchMedia("(min-width: 1024px)").matches); }, []);
  const rows: { label: string; lines: string[] }[] = [
    { label: "Weather", lines: why.weather },
    { label: "Dress code", lines: why.dressCode ? [why.dressCode] : [] },
    { label: "Color", lines: why.color ? [why.color] : [] },
    { label: "You", lines: why.taste ? [why.taste] : [] },
  ].filter((r) => r.lines.length);
  if (!rows.length) return null;
  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="group" data-testid="why-details">
      <summary className="caption flex min-h-9 cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden"><span>Why this look</span><span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span></summary>
      <ul className="flex flex-col gap-1.5 pb-1 pt-1" data-testid="why">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[86px_minmax(0,1fr)] gap-x-3 text-[15px] leading-snug">
            <span className="caption pt-0.5">{r.label}</span>
            <span className="flex flex-col gap-0.5">{r.lines.map((l, i) => <span key={i}>{l}</span>)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function CheckInSheet({ open, onClose, scales, current, busy, isAdmin, mine, personName, onTaps, onSelfie }: {
  open: boolean; onClose: () => void; scales: Scale[]; current: Props["checkIn"]; busy: string | null; isAdmin: boolean; mine: boolean; personName: string;
  onTaps: (answers: { scaleId: string; optionId: string }[]) => void; onSelfie: (file: File) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries((current?.answers ?? []).map((a) => [a.scaleId, a.optionId])));
  useEffect(() => { if (open) setAnswers(Object.fromEntries((current?.answers ?? []).map((a) => [a.scaleId, a.optionId]))); }, [open, current]);
  const file = useRef<HTMLInputElement>(null);
  // Usable while the day's looks are building (Jeff, 2 Nov 2026: "can't click button"); blocked only while another action runs.
  const blocked = busy !== null && busy !== "regen";
  return (
    <Sheet open={open} onClose={onClose} title="Check-in">
      <p className="mb-4 text-[14px] leading-snug text-graphite">{mine ? "How are you looking today?" : `How is ${personName} looking today?`} Tap, or take a selfie and let the app read it.</p>
      <div className="space-y-5">
        {scales.map((s) => (
          <div key={s.id}>
            <p className="mono mb-2 text-graphite">{s.name}</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={s.name}>
              {s.options.map((o) => {
                const on = answers[s.id] === o.id;
                return <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => setAnswers((a) => ({ ...a, [s.id]: on ? "" : o.id }))} className={cn("pill pill-sm", on && "pill-solid")}>{o.name}</button>;
              })}
            </div>
          </div>
        ))}
        {scales.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="mono text-graphite">No check-in questions yet.</p>
            {isAdmin ? <Link href="/admin/lists/checkInScale" className="pill self-start">+ Add a question</Link> : <p className="mono text-graphite">A parent admin can add them under Lists.</p>}
          </div>
        ) : null}
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <Button className="w-full" disabled={blocked} onClick={() => onTaps(Object.entries(answers).filter(([, v]) => v).map(([scaleId, optionId]) => ({ scaleId, optionId })))} data-testid="save-check-in">Save check-in</Button>
        <button type="button" className="pill h-[50px] w-full" disabled={blocked} onClick={() => file.current?.click()}>Take a selfie</button>
        <input ref={file} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onSelfie(f); e.target.value = ""; }} />
        {current?.source === "selfie" ? <p className="mono text-graphite">Read from {mine ? "your" : `${personName}’s`} selfie · only {mine ? "you" : `${personName} and a parent`} can see it</p> : null}
      </div>
    </Sheet>
  );
}

function PlanPicker({ occasions, selected, isAdmin, busy, onPick, onText, onClear }: {
  occasions: { id: string; name: string }[]; selected: string | null; isAdmin: boolean; busy: boolean; onPick: (id: string) => void; onText: () => void; onClear?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        {occasions.map((o) => (
          <button key={o.id} type="button" disabled={busy} onClick={() => onPick(o.id)} className="flex h-12 items-center justify-between border-b border-line text-[15px]" data-testid={`plan-${o.name}`}>
            <span>{o.name}</span><span className={cn("mono", selected === o.id ? "text-ink" : "text-transparent")}>✓</span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onText} className="pill pill-sm">Something else…</button>
        {isAdmin ? <InlineAdd kind="occasion" label="Add occasion" onCreated={(e) => onPick(e.id)} /> : null}
      </div>
      {onClear ? <button type="button" className="pill mt-3 h-[50px] w-full" disabled={busy} onClick={onClear}>Back to the calendar</button> : null}
    </div>
  );
}

"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeaderAction } from "@/components/header-action";
import { PageHeader } from "@/components/ui/page-header";
import { Button, buttonClass, Icons, Shelf } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Sheet } from "@/components/ui/sheet";
import { PickSheet, TextSheet } from "@/components/items/row-editor";
import { cn } from "@/lib/cn";
import type { BoardView, Piece } from "@/lib/outfits/engine";
import type { Scale } from "@/lib/checkins/service";
import type { TryOnState } from "@/lib/tryon";
import { MirrorGlyph, MirrorSheet } from "@/components/mirror/mirror-sheet";
import { useMirror } from "@/components/mirror/use-mirror";
import { checkInSelfieAction, checkInTapsAction, looksStatusAction, moreAction, rateAction, regenerateAction, removeAction, setLocationAction, setPlanAction, setZipAction, swapAction, wearAction, type LooksResult } from "./actions";
import { RatingRow } from "../fits/rating-row";
import { monoDate } from "@/lib/dates";

type Props = {
  personId: string; personName: string; mine: boolean; canDress: boolean; isAdmin: boolean;
  date: string; evening: boolean; contextLine: string; dateLabel: string;
  weather: { condition: string; source: string; nowF: number; tonightF: number; highF: number; lowF: number; rainChance: number } | null; weatherNote: "none" | "failed" | null; savedZip: string | null;
  plan: { source: string; label: string | null; occasionId: string | null }; calendarConnected: boolean; calendarConfigured: boolean;
  checkIn: { source: "taps" | "selfie"; answers: { scaleId: string; optionId: string }[] } | null; scales: Scale[];
  occasions: { id: string; name: string }[];
  suggestion: { id: string; boards: BoardView[]; wornIndex: number | null } | null;
  /** No looks for today yet: the screen asks for them in the background as soon as it opens. */
  needsLooks: boolean;
  enoughClothes: boolean; cleanOutCount: number;
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
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Today (screen 04): context line, title + counter, swipeable boards, piece list, reason, actions, Together strip. */
export function TodayScreen(p: Props) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState<"checkin" | "plan" | "planText" | "swap" | "zip" | null>(null);
  const [index, setIndex] = useState(Math.max(0, p.suggestion?.wornIndex ?? 0));
  const scroller = useRef<HTMLDivElement>(null);
  const boards = p.suggestion?.boards ?? [];
  const board = boards[index] ?? null;
  // The mirror: dressed in the background, polled, shown in the shared sheet (src/components/mirror).
  const m = useMirror(p.personId);

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
  useEffect(() => () => { if (poll.current) clearTimeout(poll.current); }, []);
  function looksDone(r: LooksResult, after?: () => void) {
    if (!r.ok) { setBusy(null); setError(r.error); router.refresh(); return; }
    if (r.pending) {
      const { jobId } = r.pending;
      poll.current = setTimeout(async () => {
        let next: LooksResult;
        try { next = await looksStatusAction(jobId); } catch { next = r; } // a dropped poll (phone asleep): ask again
        looksDone(next, after);
      }, 2000);
      return;
    }
    setBusy(null); after?.(); router.refresh();
  }
  function buildLooks(label: string, fn: () => Promise<LooksResult>, after?: () => void) {
    setError(undefined); setBusy(label);
    start(async () => {
      let r: LooksResult;
      try { r = await fn(); } catch { r = { ok: false, error: "Couldn’t build the looks. Try again." }; }
      looksDone(r, after);
    });
  }
  /** No looks for today yet: ask for them the moment the screen opens. */
  const asked = useRef(false);
  useEffect(() => {
    if (!p.needsLooks || asked.current) return;
    asked.current = true;
    buildLooks("regen", () => regenerateAction(p.personId));
  }, [p.needsLooks]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Save a check-in or plan (quick), close the sheet, then ask for fresh looks while the screen stays usable. */
  function saveThenRefresh(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setSheet(null); setError(undefined); setBusy("regen");
    start(async () => {
      const saved = await fn();
      if (!saved.ok) { setBusy(null); setError(saved.error); router.refresh(); return; }
      router.refresh();
      let r: LooksResult;
      try { r = await regenerateAction(p.personId); } catch { r = { ok: false, error: "Couldn’t build the looks. Try again." }; }
      looksDone(r, () => setIndex(0));
    });
  }

  // The board under the person's eyes drives the counter and the text: each board reports when it is
  // (mostly) in view. Programmatic moves jump without animation so the two can never drift apart.
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
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "instant" as ScrollBehavior });
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

  const worn = Boolean(board?.wornFitId);
  const [flashWorn, setFlashWorn] = useState(false); // "✓ Worn" for a beat before the button turns into the Fits link
  const title = p.evening ? "Tonight’s" : "Today’s";

  return (
    <div data-testid="today" className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-14">
      {p.canDress ? <HeaderAction><button type="button" onClick={() => setSheet("checkin")} className="pill pill-sm" data-testid="check-in">Check-in</button></HeaderAction> : null}
      {error ? <Banner tone="danger" title={error} className="mb-3 lg:col-start-2" /> : null}
      <div className="lg:col-start-2">
      <PageHeader
        eyebrow={
          <div className="flex items-start justify-between gap-3">
            <span className="text-ink" data-testid="context-line">{p.mine ? p.contextLine : `${p.personName.toUpperCase()} · ${p.contextLine}`}</span>
            {p.canDress ? <button type="button" onClick={() => setSheet("plan")} className="pill pill-sm shrink-0" data-testid="edit-plan">Edit</button> : null}
          </div>
        }
        title={title} accent="look"
        aside={boards.length ? `${pad(index + 1)} / ${pad(boards.length)}` : "00 / 03"}
      />
      </div>

      {p.weather ? (
        <button type="button" onClick={() => p.canDress && setSheet("zip")} className="mb-4 flex w-full items-stretch border border-ink text-left lg:col-start-2" data-testid="weather-block">
          <span className="flex flex-col gap-1 border-r border-ink px-4 py-2.5">
            <span className="mono text-ink" data-testid="weather-date">{p.dateLabel}</span>
            <span className="flex items-baseline gap-1"><span className="serif text-[40px] leading-none">{p.weather.nowF}°</span><span className="mono">now</span></span>
          </span>
          <span className="flex flex-1 flex-col justify-center gap-0.5 px-4 py-2">
            <span className="text-[16px] font-medium">{p.weather.condition} · {p.weather.tonightF}° tonight</span>
            <span className="mono">High {p.weather.highF}° · Low {p.weather.lowF}°{p.weather.rainChance >= 20 ? ` · Rain ${p.weather.rainChance}%` : " · No rain"}</span>
          </span>
          {p.canDress ? <span className="mono flex items-center px-3 text-ink">{p.savedZip ?? "Zip"} ›</span> : null}
        </button>
      ) : null}
      {p.weatherNote && p.canDress ? (
        <div className="mb-4 flex items-center justify-between border-y border-ink py-2.5 lg:col-start-2">
          <span className="mono">{p.weatherNote === "failed" ? "Weather is unavailable right now" : "Where are you today?"}</span>
          <span className="flex gap-4">
            {p.weatherNote === "none" ? <button type="button" onClick={askLocation} disabled={busy === "location"} className="pill pill-sm">{busy === "location" ? "Finding…" : "Use my location"}</button> : null}
            <button type="button" onClick={() => setSheet("zip")} className="pill pill-sm" data-testid="enter-zip">{p.savedZip ? "Change zip" : "Enter zip"}</button>
          </span>
        </div>
      ) : null}

      {boards.length ? (
        <>
          <div className="relative lg:col-start-1 lg:row-start-1 lg:row-span-3">
            <div ref={scroller} className="-mx-5 flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] lg:mx-0" data-testid="boards">
              {boards.map((b, i) => <Board key={i} index={i} board={b} active={i === index} />)}
            </div>
            {busy === "regen" ? <div className="absolute inset-0 flex items-center justify-center bg-paper/70" data-testid="refreshing"><span className="mono mono-11 bg-paper px-3 py-2">Building fresh looks…</span></div> : null}
          </div>
          {p.canDress && (p.tryOn === "ready" || p.mannequin) ? (
            <div className="mt-4 lg:col-start-1 lg:row-start-4 lg:row-span-4 lg:self-start" data-testid="mirror">
              <button type="button" disabled={busy !== null} onClick={() => m.show({ look: { kind: "today", suggestionId: p.suggestion!.id, index }, on: p.tryOn === "ready" ? "me" : "mannequin" })}
                className="flex w-full items-center gap-5 border border-ink p-3 text-left disabled:opacity-60" data-testid={p.tryOn === "ready" ? "try-on" : "see-on-mannequin"}>
                <span className="relative h-[150px] w-[100px] shrink-0 overflow-hidden rounded-t-[60px] border-2 border-ink bg-paper">
                  {m.tryOn ? <img src={`/api/photo/${m.tryOn.key}`} alt="" className="size-full object-cover" /> : <MirrorGlyph />}
                </span>
                <span className="flex flex-col gap-1">
                  <span className="mono text-[13px] uppercase tracking-[0.18em] text-ink">{m.busy ? "Dressing…" : "Look in the mirror"}</span>
                  <span className="text-[15px] leading-snug">{p.tryOn === "ready" ? "This look on you." : `This look on a mannequin${p.mine ? "" : ` for ${p.personName}`}.`}</span>
                  <span className="mono text-ink">Tap to see it →</span>
                </span>
              </button>
              {p.tryOn === "off" ? (
                <Link href="/profile/settings" className="mono mt-2 flex h-[42px] items-center justify-between border-b border-ink text-ink" data-testid="try-on-off"><span>Want the mirror to show you? Turn on try-on</span><span>→</span></Link>
              ) : p.tryOn === "no_photo" ? (
                <Link href="/profile/body" className="mono mt-2 flex h-[42px] items-center justify-between border-b border-ink text-ink" data-testid="try-on-photo"><span>Want the mirror to show you? Add a body photo</span><span>→</span></Link>
              ) : null}
            </div>
          ) : null}
          {board ? (
            <div className="mt-3.5 flex flex-col gap-2 lg:col-start-2 lg:mt-0">
              <p className="mono text-ink" data-testid="piece-list">{board.pieces.map((x) => x.label).join(" · ")}</p>
              <p className="text-[17px] leading-snug" data-testid="reason">{board.reason}</p>
              {board.why ? <WhyList why={board.why} /> : null}
            </div>
          ) : null}
          {p.canDress ? (
            <div className="mt-4 flex flex-col gap-2 lg:col-start-2">
              {worn && !flashWorn ? (
                <Shelf><Link href="/fits" className={buttonClass({ size: "lg", className: "w-full" })}><Icons.calendar /><span className="flex flex-col items-start gap-0.5 text-left"><span>Wearing this · see Fits</span><span className="mono text-[9px] tracking-[0.12em] opacity-75">It is on your calendar</span></span><span aria-hidden className="ml-1 transition-transform duration-100 group-active:translate-x-1">→</span></Link></Shelf>
              ) : (
                <Button size="lg" className="w-full" icon={<Icons.shirt />} sub="Lands on your Fits calendar" flash={flashWorn ? "✓ Worn" : null} disabled={busy !== null}
                  onClick={() => run("wear", () => wearAction(p.personId, p.suggestion!.id, index), () => { setFlashWorn(true); setTimeout(() => setFlashWorn(false), 900); })} data-testid="wear-this">{busy === "wear" ? "Saving…" : "Wear this"}</Button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={busy !== null || worn} onClick={() => setSheet("swap")} data-testid="swap">Change a piece</Button>
                <Button variant="secondary" disabled={busy !== null} onClick={() => { const next = boards.length; buildLooks("more", () => moreAction(p.personId), () => setIndex(next)); }} data-testid="more-looks">{busy === "more" ? "Thinking…" : "More looks"}</Button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 grid-rows-[196px_196px] gap-1.5 lg:col-start-1 lg:row-start-1 lg:row-span-6 lg:grid-rows-[200px_200px]">
            <div className="row-span-2 bg-bone" /><div className="bg-bone" />
            <div className="grid grid-cols-2 gap-1.5"><div className="bg-bone" /><div className="bg-bone" /></div>
          </div>
          <div className="mt-3.5 flex flex-col gap-1 lg:col-start-2 lg:mt-0">
            <p className="mono text-graphite">{busy === "regen" ? "Building" : "No looks yet"}</p>
            <p className="serif text-[21px] italic leading-[1.3]">
              {busy === "regen" ? "Three looks for today are on their way. About half a minute." : p.enoughClothes ? (p.canDress ? "Something went wrong building today’s looks." : `${p.personName} hasn’t opened Today yet.`) : p.mine ? "Add clothes with the + button and your first three looks will appear here." : `${p.personName}’s closet needs a few more pieces first.`}
            </p>
            {busy === "regen" ? <p className="mono text-graphite" data-testid="refreshing">Building today’s looks…</p> : null}
          </div>
          {p.enoughClothes && p.canDress && busy !== "regen" ? <Button variant="secondary" className="mt-4 w-full lg:col-start-2" disabled={busy !== null} onClick={() => buildLooks("regen", () => regenerateAction(p.personId))}>Try again</Button> : null}
        </>
      )}

      {p.unrated ? (
        <div className="mt-[18px] border-t border-ink pt-3 lg:col-start-2" data-testid="yesterday-strip">
          <p className="mono text-graphite">{monoDate(p.unrated.date)} · {p.unrated.title}</p>
          <RatingRow compact rating={null} disabled={busy !== null} onRate={(r) => { if (r) run("rate", () => rateAction(p.unrated!.id, r)); }} />
        </div>
      ) : null}

      <Link href="/today/together" className="mt-[18px] flex items-center justify-between border border-ink px-4 py-3.5 hover:bg-bone lg:col-start-2" data-testid="together-link">
        <span className="flex flex-col gap-0.5">
          <span className="serif text-[22px]">Going out <em>together?</em></span>
          <span className="mono text-ink">Dress two or more people · Coordinate, Match or Contrast</span>
        </span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M4 12h16M14 6l6 6-6 6" /></svg>
      </Link>

      {p.cleanOutCount > 0 && p.canDress ? (
        <Link href="/closet/clean-out" className="mt-3 flex items-center justify-between border border-ink px-4 py-3.5 hover:bg-bone lg:col-start-2" data-testid="clean-out-link">
          <span className="flex flex-col gap-0.5">
            <span className="serif text-[22px]">Time for a <em>clean-out?</em></span>
            <span className="mono text-ink">{p.cleanOutCount} {p.cleanOutCount === 1 ? "piece" : "pieces"} not worn in a while</span>
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M4 12h16M14 6l6 6-6 6" /></svg>
        </Link>
      ) : null}

      {p.weather ? <p className="mono mt-5 text-graphite lg:col-start-2">Weather by Open-Meteo{p.weather.source === "mock" ? " · mock" : ""}</p> : null}

      {/* Check-in: taps on each scale, or a selfie read by Claude. */}
      <CheckInSheet open={sheet === "checkin"} onClose={() => setSheet(null)} scales={p.scales} current={p.checkIn} busy={busy}
        onTaps={(answers) => saveThenRefresh(() => checkInTapsAction(p.personId, answers))}
        onSelfie={(file) => { const fd = new FormData(); fd.set("selfie", file); saveThenRefresh(() => checkInSelfieAction(p.personId, fd)); }} />

      {/* Plan: the occasion list (admins add right here), free text, or back to the calendar. */}
      <Sheet open={sheet === "plan"} onClose={() => setSheet(null)} title="Today’s plan">
        <p className="mono mb-3 text-graphite">{p.plan.source === "calendar" ? `From your calendar: ${p.plan.label}` : p.plan.source === "pick" ? `Picked: ${p.plan.label}` : p.calendarConnected ? "Nothing on your calendar today" : p.calendarConfigured ? "Connect Google Calendar in Settings, or pick a plan" : "Pick a plan"}</p>
        <PlanPicker occasions={p.occasions} selected={p.plan.occasionId} isAdmin={p.isAdmin} busy={busy !== null}
          onPick={(id) => saveThenRefresh(() => setPlanAction(p.personId, { occasionId: id }))}
          onText={() => setSheet("planText")}
          onClear={p.plan.source === "pick" ? () => saveThenRefresh(() => setPlanAction(p.personId, null)) : undefined} />
      </Sheet>
      <TextSheet open={sheet === "planText"} onClose={() => setSheet(null)} title="What’s the plan?" label="Plan" value={p.plan.source === "pick" && !p.plan.occasionId ? p.plan.label ?? "" : ""} placeholder="Dinner with the Smiths" onSave={(v) => saveThenRefresh(() => setPlanAction(p.personId, { text: v }))} />

      {/* Swap: tap the piece to replace. */}
      <Sheet open={sheet === "swap"} onClose={() => setSheet(null)} title="Change a piece">
        <p className="mono mb-2 text-graphite">Swap it for another, or take it off the look.</p>
        <div className="flex flex-col">
          {board?.pieces.map((x) => (
            <div key={x.id} className="flex h-12 items-center gap-3 border-b border-line">
              <span className="size-9 shrink-0 bg-bone">{x.thumbKey ? <img src={`/api/photo/${x.thumbKey}`} alt="" className="size-full object-contain" /> : null}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[15px]">{x.name}</span><span className="mono text-graphite">{x.label}</span></span>
              <button type="button" disabled={busy !== null} onClick={() => run("swap", () => swapAction(p.personId, index, x.id), () => setSheet(null))} className="pill pill-sm" data-testid={`swap-${x.id}`}>Swap</button>
              {(board?.pieces.length ?? 0) > 2 ? <button type="button" disabled={busy !== null} onClick={() => run("swap", () => removeAction(p.personId, index, x.id), () => setSheet(null))} className="pill pill-sm pill-quiet" data-testid={`remove-${x.id}`}>Remove</button> : null}
            </div>
          ))}
        </div>
        {busy === "swap" ? <p className="mono mt-3 text-graphite">Thinking…</p> : null}
      </Sheet>

      {/* See it on: the look on your own body photo (yours alone), or on the shared mannequin (no body in it). */}
      <MirrorSheet m={m} pieces={board?.pieces.map((x) => x.label).join(" · ") ?? ""} mine={p.mine} personId={p.personId} personName={p.personName} tryOnState={p.tryOn} backPhoto={p.backPhoto} mannequinAvailable={p.mannequinAvailable} />

      <TextSheet open={sheet === "zip"} onClose={() => setSheet(null)} title="Weather for your zip" label="Zip code" value={p.savedZip ?? ""} placeholder="92101" onSave={(v) => run("zip", () => setZipAction(v))} />
    </div>
  );
}

function Tile({ piece, className }: { piece?: BoardView["pieces"][number]; className?: string }) {
  return (
    <div className={cn("overflow-hidden bg-paper", className)}>
      {piece?.thumbKey ? <img src={`/api/photo/${piece.thumbKey}`} alt={piece.name} className="size-full object-contain" /> : piece ? <div className="flex size-full items-center justify-center border border-dashed border-ink p-3 text-center"><span className="mono text-ink">{piece.name}<br /><span className="text-graphite">No photo yet</span></span></div> : null}
    </div>
  );
}

/**
 * The board fits its pieces, never shows an empty box: one piece fills it; two stack, top over bottom;
 * three put the hero on the left with two on the right; four or more use the 2×2 with the hero tall.
 * Pieces past the fourth live in the piece list.
 */
/** Where a piece sits in the stack: what you wear on top first, shoes last; anything else (bags, hats, jewelry) in a small row under. */
const STACK: Record<string, number> = { Outerwear: 0, Tops: 1, Activewear: 1, Dresses: 1, Swimwear: 1, Sleepwear: 1, Bottoms: 2, Shoes: 3 };
function slotOf(p: Piece): number { return p.category && p.category in STACK ? STACK[p.category] : 4; }
/** Width and height of each slot as a share of the board, so the top sits over the bottom with the shoes under, like an outfit laid out on a bed. */
const SLOT = [
  { w: "w-[74%]", h: "h-[210px] lg:h-[176px]", mt: "" },           // outerwear
  { w: "w-[70%]", h: "h-[200px] lg:h-[168px]", mt: "-mt-10 lg:-mt-8" },  // top / dress
  { w: "w-[62%]", h: "h-[200px] lg:h-[168px]", mt: "-mt-7 lg:-mt-6" },   // bottom
  { w: "w-[40%]", h: "h-[104px] lg:h-[88px]", mt: "-mt-4 lg:-mt-3" },    // shoes
];

/**
 * The board lays the look out as an outfit (Jeff, 19 Oct 2026): the top over the bottom, shoes
 * under, each centered and slightly overlapping, white behind, no boxes. Accessories sit in a small
 * row at the end. One piece alone fills the board.
 */
function Board({ board, index, active }: { board: BoardView; index: number; active: boolean }) {
  const n = board.pieces.length;
  const sorted = [...board.pieces].sort((a, b) => slotOf(a) - slotOf(b));
  const stacked = sorted.filter((p) => slotOf(p) < 4);
  const extras = sorted.filter((p) => slotOf(p) === 4);
  return (
    <div className="w-full shrink-0 snap-center px-5 lg:px-0" aria-hidden={!active} data-testid="board" data-index={index} data-pieces={n}>
      {n <= 1 ? (
        <Tile piece={board.pieces[0]} className="h-[400px] lg:h-[406px]" />
      ) : (
        <div className="flex flex-col items-center" data-testid="outfit-stack">
          {stacked.map((p, i) => { const sl = SLOT[slotOf(p)]; return <Tile key={p.id} piece={p} className={`${sl.w} ${sl.h} ${i === 0 ? "" : sl.mt}`} />; })}
          {extras.length ? <div className="mt-2 flex w-full justify-center gap-2">{extras.map((p) => <Tile key={p.id} piece={p} className="h-[88px] w-[28%] lg:h-[72px]" />)}</div> : null}
        </div>
      )}
    </div>
  );
}

/** Plain bullets under the sentence: weather by name with the numbers, then dress code, color, and what the person reaches for. */
function WhyList({ why }: { why: NonNullable<BoardView["why"]> }) {
  const rows: { label: string; lines: string[] }[] = [
    { label: "Weather", lines: why.weather },
    { label: "Dress code", lines: why.dressCode ? [why.dressCode] : [] },
    { label: "Color", lines: why.color ? [why.color] : [] },
    { label: "You", lines: why.taste ? [why.taste] : [] },
  ].filter((r) => r.lines.length);
  if (!rows.length) return null;
  return (
    <ul className="flex flex-col gap-1.5 border-t border-line pt-2" data-testid="why">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[86px_minmax(0,1fr)] gap-x-3 text-[14px] leading-snug">
          <span className="mono pt-0.5 text-graphite">{r.label}</span>
          <span className="flex flex-col gap-0.5">{r.lines.map((l, i) => <span key={i}>{l}</span>)}</span>
        </li>
      ))}
    </ul>
  );
}

function CheckInSheet({ open, onClose, scales, current, busy, onTaps, onSelfie }: {
  open: boolean; onClose: () => void; scales: Scale[]; current: Props["checkIn"]; busy: string | null;
  onTaps: (answers: { scaleId: string; optionId: string }[]) => void; onSelfie: (file: File) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries((current?.answers ?? []).map((a) => [a.scaleId, a.optionId])));
  useEffect(() => { if (open) setAnswers(Object.fromEntries((current?.answers ?? []).map((a) => [a.scaleId, a.optionId]))); }, [open, current]);
  const file = useRef<HTMLInputElement>(null);
  return (
    <Sheet open={open} onClose={onClose} title="Check-in">
      <p className="mono mb-4 text-graphite">How are you looking today? Tap, or take a selfie and let the app read it.</p>
      <div className="space-y-5">
        {scales.map((s) => (
          <div key={s.id}>
            <p className="mono mb-2 text-graphite">{s.name}</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={s.name}>
              {s.options.map((o) => {
                const on = answers[s.id] === o.id;
                return <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => setAnswers((a) => ({ ...a, [s.id]: on ? "" : o.id }))} className={cn("mono mono-11 h-10 border px-3 uppercase", on ? "border-ink bg-ink text-paper" : "border-ink bg-paper text-ink")}>{o.name}</button>;
              })}
            </div>
          </div>
        ))}
        {scales.length === 0 ? <p className="mono text-graphite">No check-in scales yet. Admins add them under Admin → Lists.</p> : null}
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <Button className="w-full" disabled={busy !== null} onClick={() => onTaps(Object.entries(answers).filter(([, v]) => v).map(([scaleId, optionId]) => ({ scaleId, optionId })))} data-testid="save-check-in">{busy === "checkin" ? "Saving…" : "Save check-in"}</Button>
        <Button variant="secondary" className="w-full" disabled={busy !== null} onClick={() => file.current?.click()}>Take a selfie</Button>
        <input ref={file} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onSelfie(f); e.target.value = ""; }} />
        {current?.source === "selfie" ? <p className="mono text-graphite">Read from your selfie · only you can see it</p> : null}
      </div>
    </Sheet>
  );
}

function PlanPicker({ occasions, selected, isAdmin, busy, onPick, onText, onClear }: {
  occasions: { id: string; name: string }[]; selected: string | null; isAdmin: boolean; busy: boolean; onPick: (id: string) => void; onText: () => void; onClear?: () => void;
}) {
  const [pick, setPick] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        {occasions.map((o) => (
          <button key={o.id} type="button" disabled={busy} onClick={() => onPick(o.id)} className="flex h-12 items-center justify-between border-b border-line text-[15px]" data-testid={`plan-${o.name}`}>
            <span>{o.name}</span><span className={cn("mono", selected === o.id ? "text-ink" : "text-transparent")}>✓</span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button type="button" onClick={onText} className="pill pill-sm">Something else…</button>
        {isAdmin ? <button type="button" onClick={() => setPick(true)} className="pill pill-sm">Edit list</button> : null}
      </div>
      {onClear ? <Button variant="secondary" className="mt-2 w-full" disabled={busy} onClick={onClear}>Back to my calendar</Button> : null}
      <PickSheet open={pick} onClose={() => setPick(false)} title="Occasions" kind="occasion" options={occasions} selected={selected ? [selected] : []} canAdd onChange={(ids) => { if (ids[0]) onPick(ids[0]); }} />
    </div>
  );
}

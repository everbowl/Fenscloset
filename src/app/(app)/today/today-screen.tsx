"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeaderAction } from "@/components/header-action";
import { PageHeader } from "@/components/ui/page-header";
import { Button, LIFT } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Sheet } from "@/components/ui/sheet";
import { PickSheet, TextSheet } from "@/components/items/row-editor";
import { cn } from "@/lib/cn";
import type { BoardView } from "@/lib/outfits/engine";
import type { Scale } from "@/lib/checkins/service";
import type { TryOnState, TryOnView } from "@/lib/tryon";
import { checkInSelfieAction, checkInTapsAction, mannequinAction, moreAction, rateAction, regenerateAction, removeAction, setLocationAction, setPlanAction, setZipAction, swapAction, tryOnAction, wearAction } from "./actions";
import { RatingRow } from "../fits/rating-row";
import { monoDate } from "@/lib/dates";

type Props = {
  personId: string; personName: string; mine: boolean; canDress: boolean; isAdmin: boolean;
  date: string; evening: boolean; contextLine: string;
  weather: { condition: string; source: string } | null; weatherNote: "none" | "failed" | null; savedZip: string | null;
  plan: { source: string; label: string | null; occasionId: string | null }; calendarConnected: boolean; calendarConfigured: boolean;
  checkIn: { source: "taps" | "selfie"; answers: { scaleId: string; optionId: string }[] } | null; scales: Scale[];
  occasions: { id: string; name: string }[];
  suggestion: { id: string; boards: BoardView[]; wornIndex: number | null } | null;
  enoughClothes: boolean; cleanOutCount: number;
  /** The most recent fit (last 7 days) with no "how did it go?" answer yet. */
  unrated: { id: string; date: string; title: string } | null;
  /** Whether TRY IT ON is offered: ready, or why not (off → Settings link; no_photo → Body page link). Hidden for minors and others' closets. */
  tryOn: TryOnState;
  /** SEE IT ON falls back to the shared mannequin (no body photo needed; minors and parents too) when the person's own try-on is not ready. */
  mannequin: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Today (screen 04): context line, title + counter, swipeable boards, piece list, reason, actions, Together strip. */
export function TodayScreen(p: Props) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState<"checkin" | "plan" | "planText" | "swap" | "zip" | "tryon" | null>(null);
  const [tryOn, setTryOn] = useState<TryOnView | null>(null);
  const [index, setIndex] = useState(Math.max(0, p.suggestion?.wornIndex ?? 0));
  const scroller = useRef<HTMLDivElement>(null);
  const boards = p.suggestion?.boards ?? [];
  const board = boards[index] ?? null;

  function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(undefined); setBusy(label);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) setError(r.error); else after?.();
      router.refresh();
    });
  }
  /** Save a check-in or plan (quick), close the sheet, then ask for fresh looks while the screen stays usable. */
  function saveThenRefresh(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setSheet(null); setError(undefined); setBusy("regen");
    start(async () => {
      const saved = await fn();
      if (!saved.ok) { setBusy(null); setError(saved.error); router.refresh(); return; }
      router.refresh();
      const r = await regenerateAction(p.personId);
      setBusy(null);
      if (!r.ok) setError(r.error);
      setIndex(0);
      router.refresh();
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
  const title = p.evening ? "Tonight’s" : "Today’s";

  return (
    <div data-testid="today" className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-14">
      {p.canDress ? <HeaderAction><button type="button" onClick={() => setSheet("checkin")} className="mono mono-11 px-2 py-3" data-testid="check-in">Check-in</button></HeaderAction> : null}
      {error ? <Banner tone="danger" title={error} className="mb-3 lg:col-start-2" /> : null}
      <div className="lg:col-start-2">
      <PageHeader
        eyebrow={
          <div className="flex items-start justify-between gap-3">
            <span data-testid="context-line">{p.mine ? p.contextLine : `${p.personName.toUpperCase()} · ${p.contextLine}`}</span>
            {p.canDress ? <button type="button" onClick={() => setSheet("plan")} className="mono shrink-0 text-ink" data-testid="edit-plan">Edit</button> : null}
          </div>
        }
        title={title} accent="look"
        aside={boards.length ? `${pad(index + 1)} / ${pad(boards.length)}` : "00 / 03"}
      />
      </div>

      {p.weatherNote && p.canDress ? (
        <div className="mb-4 flex items-center justify-between border-y border-ink py-2.5 lg:col-start-2">
          <span className="mono">{p.weatherNote === "failed" ? "Weather is unavailable right now" : "Where are you today?"}</span>
          <span className="flex gap-4">
            {p.weatherNote === "none" ? <button type="button" onClick={askLocation} disabled={busy === "location"} className="mono mono-11">{busy === "location" ? "Finding…" : "Use my location"}</button> : null}
            <button type="button" onClick={() => setSheet("zip")} className="mono mono-11" data-testid="enter-zip">{p.savedZip ? "Change zip" : "Enter zip"}</button>
          </span>
        </div>
      ) : null}

      {boards.length ? (
        <>
          <div className="relative lg:col-start-1 lg:row-start-1 lg:row-span-6">
            <div ref={scroller} className="-mx-5 flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] lg:mx-0" data-testid="boards">
              {boards.map((b, i) => <Board key={i} index={i} board={b} active={i === index} />)}
            </div>
            {busy === "regen" ? <div className="absolute inset-0 flex items-center justify-center bg-paper/70" data-testid="refreshing"><span className="mono mono-11 bg-paper px-3 py-2">Building fresh looks…</span></div> : null}
          </div>
          {board ? (
            <div className="mt-3.5 flex flex-col gap-2 lg:col-start-2 lg:mt-0">
              <p className="mono text-graphite" data-testid="piece-list">{board.pieces.map((x) => x.label).join(" · ")}</p>
              <p className="text-[17px] leading-snug" data-testid="reason">{board.reason}</p>
              {board.why ? <WhyList why={board.why} /> : null}
            </div>
          ) : null}
          {p.canDress ? (
            <div className="mt-4 flex flex-col gap-2 lg:col-start-2">
              {worn ? (
                <Link href="/fits" className={`mono flex h-[58px] items-center justify-center bg-ink text-[12px] uppercase tracking-[0.16em] text-paper ${LIFT}`}>Wearing this · see Fits →</Link>
              ) : (
                <Button size="lg" className="w-full" disabled={busy !== null} onClick={() => run("wear", () => wearAction(p.personId, p.suggestion!.id, index))} data-testid="wear-this">{busy === "wear" ? "Saving…" : "Wear this"}</Button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={busy !== null || worn} onClick={() => setSheet("swap")} data-testid="swap">Change a piece</Button>
                <Button variant="secondary" disabled={busy !== null} onClick={() => { const next = boards.length; run("more", () => moreAction(p.personId), () => setIndex(next)); }} data-testid="more-looks">{busy === "more" ? "Thinking…" : "More looks"}</Button>
              </div>
              {p.tryOn === "ready" ? (
                <Button variant="secondary" disabled={busy !== null} onClick={() => { setBusy("tryon"); setError(undefined); start(async () => { const r = await tryOnAction(p.personId, p.suggestion!.id, index); setBusy(null); if (!r.ok) setError(r.error); else if (r.tryOn) { setTryOn(r.tryOn); setSheet("tryon"); } }); }} data-testid="try-on">{busy === "tryon" ? "Dressing you…" : "See it on"}</Button>
              ) : p.mannequin ? (
                <Button variant="secondary" disabled={busy !== null} onClick={() => { setBusy("tryon"); setError(undefined); start(async () => { const r = await mannequinAction(p.personId, p.suggestion!.id, index); setBusy(null); if (!r.ok) setError(r.error); else if (r.tryOn) { setTryOn(r.tryOn); setSheet("tryon"); } }); }} data-testid="see-on-mannequin">{busy === "tryon" ? "Dressing the mannequin…" : "See it on"}</Button>
              ) : null}
              {p.tryOn === "off" ? (
                <Link href="/profile/settings" className="mono flex h-[38px] items-center justify-center text-graphite" data-testid="try-on-off">Want it on you? Turn on try-on in Settings</Link>
              ) : p.tryOn === "no_photo" ? (
                <Link href="/profile/body" className="mono flex h-[38px] items-center justify-center text-graphite" data-testid="try-on-photo">Want it on you? Add a body photo first</Link>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 grid-rows-[196px_196px] gap-1.5 lg:col-start-1 lg:row-start-1 lg:row-span-6 lg:grid-rows-[300px_300px]">
            <div className="row-span-2 bg-bone" /><div className="bg-bone" />
            <div className="grid grid-cols-2 gap-1.5"><div className="bg-bone" /><div className="bg-bone" /></div>
          </div>
          <div className="mt-3.5 flex flex-col gap-1 lg:col-start-2 lg:mt-0">
            <p className="mono text-graphite">No looks yet</p>
            <p className="serif text-[21px] italic leading-[1.3]">
              {p.enoughClothes ? (p.canDress ? "Something went wrong building today’s looks." : `${p.personName} hasn’t opened Today yet.`) : p.mine ? "Add clothes with the + button and your first three looks will appear here." : `${p.personName}’s closet needs a few more pieces first.`}
            </p>
          </div>
          {p.enoughClothes && p.canDress ? <Button variant="secondary" className="mt-4 w-full lg:col-start-2" disabled={busy !== null} onClick={() => run("regen", () => regenerateAction(p.personId))}>{busy === "regen" ? "Thinking…" : "Try again"}</Button> : null}
        </>
      )}

      {p.unrated ? (
        <div className="mt-[18px] border-t border-ink pt-3 lg:col-start-2" data-testid="yesterday-strip">
          <p className="mono text-graphite">{monoDate(p.unrated.date)} · {p.unrated.title}</p>
          <RatingRow compact rating={null} disabled={busy !== null} onRate={(r) => { if (r) run("rate", () => rateAction(p.unrated!.id, r)); }} />
        </div>
      ) : null}

      <Link href="/today/together" className="mt-[18px] flex items-center justify-between border-y border-ink py-3.5 lg:col-start-2" data-testid="together-link">
        <span className="flex flex-col gap-0.5">
          <span className="serif text-[22px]">Going out <em>together?</em></span>
          <span className="mono text-graphite">Coordinate · Match · Contrast</span>
        </span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M4 12h16M14 6l6 6-6 6" /></svg>
      </Link>

      {p.cleanOutCount > 0 && p.canDress ? (
        <Link href="/closet/clean-out" className="mt-3 flex items-center justify-between border-b border-ink py-3.5 lg:col-start-2" data-testid="clean-out-link">
          <span className="flex flex-col gap-0.5">
            <span className="serif text-[22px]">Time for a <em>clean-out?</em></span>
            <span className="mono text-graphite">{p.cleanOutCount} {p.cleanOutCount === 1 ? "piece" : "pieces"} not worn in a while</span>
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
              <button type="button" disabled={busy !== null} onClick={() => run("swap", () => swapAction(p.personId, index, x.id), () => setSheet(null))} className="mono mono-11 h-9 border border-ink px-3" data-testid={`swap-${x.id}`}>Swap</button>
              {(board?.pieces.length ?? 0) > 2 ? <button type="button" disabled={busy !== null} onClick={() => run("swap", () => removeAction(p.personId, index, x.id), () => setSheet(null))} className="mono mono-11 h-9 px-2 text-graphite" data-testid={`remove-${x.id}`}>Remove</button> : null}
            </div>
          ))}
        </div>
        {busy === "swap" ? <p className="mono mt-3 text-graphite">Thinking…</p> : null}
      </Sheet>

      {/* See it on: the look on your own body photo (yours alone), or on the shared mannequin (no body in it). */}
      <Sheet open={sheet === "tryon"} onClose={() => setSheet(null)} title={tryOn?.mannequin ? "On a mannequin" : "On you"}>
        {tryOn ? (
          <div className="flex flex-col gap-3" data-testid="try-on-sheet">
            <div className="h-[460px] overflow-hidden bg-bone"><img src={`/api/photo/${tryOn.key}`} alt={tryOn.mannequin ? "This look on a mannequin" : "You wearing this look"} className="size-full object-contain" /></div>
            <p className="mono text-graphite">{board?.pieces.map((x) => x.label).join(" · ")}</p>
            <p className="mono text-graphite">{tryOn.mannequin ? `No body photo used${p.mine ? "" : ` · ${p.personName}’s look`}` : "Only you can see this picture"}{tryOn.cached ? " · saved from before" : ""}</p>
          </div>
        ) : null}
      </Sheet>

      <TextSheet open={sheet === "zip"} onClose={() => setSheet(null)} title="Weather for your zip" label="Zip code" value={p.savedZip ?? ""} placeholder="92101" onSave={(v) => run("zip", () => setZipAction(v))} />
    </div>
  );
}

function Tile({ piece, className }: { piece?: BoardView["pieces"][number]; className?: string }) {
  return (
    <div className={cn("overflow-hidden bg-bone", className)}>
      {piece?.thumbKey ? <img src={`/api/photo/${piece.thumbKey}`} alt={piece.name} className="size-full object-contain" /> : piece ? <div className="flex size-full items-end p-2"><span className="mono text-graphite">{piece.name}</span></div> : null}
    </div>
  );
}

/**
 * The board fits its pieces, never shows an empty box: one piece fills it; two stack, top over bottom;
 * three put the hero on the left with two on the right; four or more use the 2×2 with the hero tall.
 * Pieces past the fourth live in the piece list.
 */
function Board({ board, index, active }: { board: BoardView; index: number; active: boolean }) {
  const [hero, two, three, four] = board.pieces;
  const n = board.pieces.length;
  return (
    <div className="w-full shrink-0 snap-center px-5 lg:px-0" aria-hidden={!active} data-testid="board" data-index={index} data-pieces={n}>
      {n <= 1 ? (
        <Tile piece={hero} className="h-[400px] lg:h-[608px]" />
      ) : n === 2 ? (
        <div className="grid grid-rows-[196px_196px] gap-1.5 lg:grid-rows-[300px_300px]"><Tile piece={hero} /><Tile piece={two} /></div>
      ) : n === 3 ? (
        <div className="grid grid-cols-2 grid-rows-[196px_196px] gap-1.5 lg:grid-rows-[300px_300px]"><Tile piece={hero} className="row-span-2" /><Tile piece={two} /><Tile piece={three} /></div>
      ) : (
        <div className="grid grid-cols-2 grid-rows-[196px_196px] gap-1.5 lg:grid-rows-[300px_300px]">
          <Tile piece={hero} className="row-span-2" />
          <Tile piece={two} />
          <div className="grid grid-cols-2 gap-1.5"><Tile piece={three} /><Tile piece={four} /></div>
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
        <button type="button" onClick={onText} className="mono mono-11">Something else…</button>
        {isAdmin ? <button type="button" onClick={() => setPick(true)} className="mono mono-11">Edit list</button> : null}
      </div>
      {onClear ? <Button variant="secondary" className="mt-2 w-full" disabled={busy} onClick={onClear}>Back to my calendar</Button> : null}
      <PickSheet open={pick} onClose={() => setPick(false)} title="Occasions" kind="occasion" options={occasions} selected={selected ? [selected] : []} canAdd onChange={(ids) => { if (ids[0]) onPick(ids[0]); }} />
    </div>
  );
}

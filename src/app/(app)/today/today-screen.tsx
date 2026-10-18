"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeaderAction } from "@/components/header-action";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Sheet } from "@/components/ui/sheet";
import { PickSheet, TextSheet } from "@/components/items/row-editor";
import { cn } from "@/lib/cn";
import type { BoardView } from "@/lib/outfits/engine";
import type { Scale } from "@/lib/checkins/service";
import { checkInSelfieAction, checkInTapsAction, moreAction, regenerateAction, setLocationAction, setPlanAction, setZipAction, swapAction, wearAction } from "./actions";

type Props = {
  personId: string; personName: string; mine: boolean; canDress: boolean; isAdmin: boolean;
  date: string; evening: boolean; contextLine: string;
  weather: { condition: string; source: string } | null; weatherNote: "none" | "failed" | null; savedZip: string | null;
  plan: { source: string; label: string | null; occasionId: string | null }; calendarConnected: boolean; calendarConfigured: boolean;
  checkIn: { source: "taps" | "selfie"; answers: { scaleId: string; optionId: string }[] } | null; scales: Scale[];
  occasions: { id: string; name: string }[];
  suggestion: { id: string; boards: BoardView[]; wornIndex: number | null } | null;
  enoughClothes: boolean; cleanOutCount: number;
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

  function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(undefined); setBusy(label);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) setError(r.error); else after?.();
      router.refresh();
    });
  }

  // The swipe drives the counter: update the index once scrolling settles. Programmatic moves (goTo) and
  // re-renders after a server action re-sync the scroll position to the current index instead.
  const syncing = useRef(false);
  const indexRef = useRef(index);
  indexRef.current = index;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const settle = () => { if (syncing.current) return; const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth)); if (i >= 0 && i < boards.length && i !== indexRef.current) setIndex(i); };
    const onScroll = () => { clearTimeout(t); t = setTimeout(settle, 120); };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { clearTimeout(t); el.removeEventListener("scroll", onScroll); };
  }, [boards.length]);
  const goTo = (i: number) => {
    const el = scroller.current;
    syncing.current = true;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "auto" });
    setIndex(i);
    setTimeout(() => { syncing.current = false; }, 250);
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
          <div ref={scroller} className="-mx-5 flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] lg:col-start-1 lg:row-start-1 lg:row-span-6 lg:mx-0" data-testid="boards">
            {boards.map((b, i) => <Board key={i} board={b} active={i === index} />)}
          </div>
          {board ? (
            <div className="mt-3.5 flex flex-col gap-1 lg:col-start-2 lg:mt-0">
              <p className="mono text-graphite" data-testid="piece-list">{board.pieces.map((x) => x.label).join(" · ")}</p>
              <p className="serif text-[21px] italic leading-[1.3]" data-testid="reason">{board.reason}</p>
            </div>
          ) : null}
          {p.canDress ? (
            <div className="mt-4 flex flex-col gap-2 lg:col-start-2">
              {worn ? (
                <Link href="/fits" className="mono flex h-[54px] items-center justify-center bg-ink text-[12px] uppercase tracking-[0.16em] text-paper">Wearing this · see Fits</Link>
              ) : (
                <Button size="lg" className="w-full" disabled={busy !== null} onClick={() => run("wear", () => wearAction(p.personId, p.suggestion!.id, index))} data-testid="wear-this">{busy === "wear" ? "Saving…" : "Wear this"}</Button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={busy !== null || worn} onClick={() => setSheet("swap")} data-testid="swap">Swap one piece</Button>
                <Button variant="secondary" disabled={busy !== null} onClick={() => { const next = boards.length; run("more", () => moreAction(p.personId), () => setIndex(next)); }} data-testid="more-looks">{busy === "more" ? "Thinking…" : "More looks"}</Button>
              </div>
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
        onTaps={(answers) => run("checkin", () => checkInTapsAction(p.personId, answers), () => setSheet(null))}
        onSelfie={(file) => { const fd = new FormData(); fd.set("selfie", file); run("checkin", () => checkInSelfieAction(p.personId, fd), () => setSheet(null)); }} />

      {/* Plan: the occasion list (admins add right here), free text, or back to the calendar. */}
      <Sheet open={sheet === "plan"} onClose={() => setSheet(null)} title="Today’s plan">
        <p className="mono mb-3 text-graphite">{p.plan.source === "calendar" ? `From your calendar: ${p.plan.label}` : p.plan.source === "pick" ? `Picked: ${p.plan.label}` : p.calendarConnected ? "Nothing on your calendar today" : p.calendarConfigured ? "Connect Google Calendar in Settings, or pick a plan" : "Pick a plan"}</p>
        <PlanPicker occasions={p.occasions} selected={p.plan.occasionId} isAdmin={p.isAdmin} busy={busy !== null}
          onPick={(id) => run("plan", () => setPlanAction(p.personId, { occasionId: id }), () => setSheet(null))}
          onText={() => setSheet("planText")}
          onClear={p.plan.source === "pick" ? () => run("plan", () => setPlanAction(p.personId, null), () => setSheet(null)) : undefined} />
      </Sheet>
      <TextSheet open={sheet === "planText"} onClose={() => setSheet(null)} title="What’s the plan?" label="Plan" value={p.plan.source === "pick" && !p.plan.occasionId ? p.plan.label ?? "" : ""} placeholder="Dinner with the Smiths" onSave={(v) => run("plan", () => setPlanAction(p.personId, { text: v }))} />

      {/* Swap: tap the piece to replace. */}
      <Sheet open={sheet === "swap"} onClose={() => setSheet(null)} title="Swap one piece">
        <p className="mono mb-2 text-graphite">Which piece?</p>
        <div className="flex flex-col">
          {board?.pieces.map((x) => (
            <button key={x.id} type="button" disabled={busy !== null} onClick={() => run("swap", () => swapAction(p.personId, index, x.id), () => setSheet(null))} className="flex h-12 items-center gap-3 border-b border-line text-left" data-testid={`swap-${x.id}`}>
              <span className="size-9 shrink-0 bg-bone">{x.thumbKey ? <img src={`/api/photo/${x.thumbKey}`} alt="" className="size-full object-cover" /> : null}</span>
              <span className="flex-1 truncate text-[15px]">{x.name}</span>
              <span className="mono text-graphite">{x.label}</span>
            </button>
          ))}
        </div>
        {busy === "swap" ? <p className="mono mt-3 text-graphite">Thinking…</p> : null}
      </Sheet>

      <TextSheet open={sheet === "zip"} onClose={() => setSheet(null)} title="Weather for your zip" label="Zip code" value={p.savedZip ?? ""} placeholder="92101" onSave={(v) => run("zip", () => setZipAction(v))} />
    </div>
  );
}

/** 2-col board: hero spans both rows, one piece top right, two small bottom right. Extra pieces live in the piece list. */
function Board({ board, active }: { board: BoardView; active: boolean }) {
  const [hero, two, three, four] = board.pieces;
  const Tile = ({ piece, className }: { piece?: BoardView["pieces"][number]; className?: string }) => (
    <div className={cn("overflow-hidden bg-bone", className)}>
      {piece?.thumbKey ? <img src={`/api/photo/${piece.thumbKey}`} alt={piece.name} className="size-full object-cover" /> : piece ? <div className="flex size-full items-end p-2"><span className="mono text-graphite">{piece.name}</span></div> : null}
    </div>
  );
  return (
    <div className="w-full shrink-0 snap-center px-5 lg:px-0" aria-hidden={!active} data-testid="board">
      <div className="grid grid-cols-2 grid-rows-[196px_196px] gap-1.5 lg:grid-rows-[300px_300px]">
        <Tile piece={hero} className="row-span-2" />
        <Tile piece={two} />
        <div className="grid grid-cols-2 gap-1.5"><Tile piece={three} /><Tile piece={four} /></div>
      </div>
    </div>
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

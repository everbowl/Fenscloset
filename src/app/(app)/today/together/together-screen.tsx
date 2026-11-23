"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { PickSheet, TextSheet } from "@/components/items/row-editor";
import { cn } from "@/lib/cn";
import type { TogetherView } from "@/lib/outfits/together";
import type { TogetherMode } from "@/generated/prisma/client";
import { dressTogetherAction, togetherStatusAction, wearTogetherAction, type TogetherResult } from "./actions";

const MODES: { key: TogetherMode; label: string; blurb: string }[] = [
  { key: "coordinate", label: "Coordinate", blurb: "Same mood, complementary colors" },
  { key: "match", label: "Match", blurb: "Clearly matching colors or pieces" },
  { key: "contrast", label: "Contrast", blurb: "Deliberately different, still together" },
];

/** "Tops" from "TOPS": labels arrive shouted; the screen reads them in sentence case. */
const sentence = (s: string) => s.length ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
const LOST = "Lost the connection. Try again.";
const POLL_MS = 2000, POLL_SLOW_MS = 4000, POLL_SLOW_AFTER_MS = 30_000, POLL_GIVE_UP_MS = 5 * 60_000;

/**
 * Together (v2): who, how, the plan, one colored button; then a card per person with their look. Dressing runs in the
 * background and is polled like Today's looks, with the wait card saying where it is (review D 8.1).
 */
export function TogetherScreen({ meId, people, canDressIds, occasions, isAdmin, session, remembered = null }: {
  meId: string; people: { id: string; name: string }[]; canDressIds: string[]; occasions: { id: string; name: string }[]; isAdmin: boolean; session: TogetherView | null;
  /** The last person picked under "Shopping for" (N1): starts picked beside you. */ remembered?: string | null;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [ids, setIds] = useState<string[]>(session ? [...session.boards.map((b) => b.personId), ...session.missing.map((m) => m.personId)] : [meId, ...(remembered && remembered !== meId ? [remembered] : [])]);
  const [mode, setMode] = useState<TogetherMode>(session?.mode ?? "coordinate");
  // Seeded from the session, so "Change" then "Dress us" keeps the occasion an occasion, not free text (review D 8.7).
  const [occasionId, setOccasionId] = useState<string | null>(session?.occasionId ?? null);
  const [text, setText] = useState<string | null>(session && !session.occasionId ? session.occasionLabel : null);
  const [sheet, setSheet] = useState<"occasion" | "text" | null>(null);
  const [editing, setEditing] = useState(!session);
  const [step, setStep] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [secs, setSecs] = useState(0);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  useEffect(() => () => { seq.current++; if (poll.current) clearTimeout(poll.current); }, []);
  useEffect(() => {
    if (startedAt === null) { setSecs(0); return; }
    const tick = () => setSecs(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  /** One tap, one answer (review D 7.1): a dropped request is an error with words, never a stuck button. */
  function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setBusy(label);
    start(async () => {
      let r: { ok: boolean; error?: string };
      try { r = await fn(); } catch { r = { ok: false, error: LOST }; }
      setBusy(null);
      if (!r.ok) toast.error(r.error ?? LOST); else after?.();
      router.refresh();
    });
  }

  function dressed(r: TogetherResult, mine: number, since: number) {
    if (mine !== seq.current) return;
    if (!r.ok) { setBusy(null); setStep(null); setStartedAt(null); toast.error(r.error); return; }
    if ("pending" in r) {
      setStep(r.pending.step);
      if (Date.now() - since > POLL_GIVE_UP_MS) { setBusy(null); setStep(null); setStartedAt(null); toast.error("Dressing everyone is taking too long. Try again."); return; }
      poll.current = setTimeout(async () => {
        if (mine !== seq.current) return;
        let next: TogetherResult;
        try { next = await togetherStatusAction(r.pending.jobId); } catch { next = r; } // a dropped poll (phone asleep): ask again
        dressed(next, mine, since);
      }, Date.now() - since > POLL_SLOW_AFTER_MS ? POLL_SLOW_MS : POLL_MS);
      return;
    }
    setBusy(null); setStep(null); setStartedAt(null); setEditing(false);
    router.replace(`/today/together?s=${r.id}`);
    router.refresh();
  }
  function dress() {
    const mine = ++seq.current;
    if (poll.current) clearTimeout(poll.current);
    setBusy("dress"); setStep("Getting ready…"); setStartedAt(Date.now());
    start(async () => {
      let r: TogetherResult;
      try { r = await dressTogetherAction({ personIds: ids, mode, occasionId, occasionText: occasionId ? null : text }); } catch { r = { ok: false, error: LOST }; }
      dressed(r, mine, Date.now());
    });
  }
  const planLabel = occasionId ? occasions.find((o) => o.id === occasionId)?.name ?? null : text;
  const dressing = busy === "dress";

  return (
    <div data-testid="together">
      <PageHeader title="Together" aside={session && !editing ? <button type="button" onClick={() => setEditing(true)} className="pill pill-sm">Change</button> : undefined} />

      {editing ? (
        <div className="flex flex-col gap-4 lg:max-w-[560px]">
          <section className="card p-4">
            <p className="section mb-2">Who</p>
            <div className="flex flex-col">
              {people.map((p) => {
                const on = ids.includes(p.id);
                return (
                  <button key={p.id} type="button" role="checkbox" aria-checked={on} onClick={() => setIds(on ? ids.filter((x) => x !== p.id) : [...ids, p.id])} className="tap -mx-2 flex min-h-12 items-center justify-between rounded-xl px-2 text-[16px]" data-testid={`together-person-${p.name}`}>
                    <span>{p.name}{p.id === meId ? " (me)" : ""}</span>
                    <span className={cn("flex size-6 items-center justify-center rounded-full", on ? "bg-ink text-paper" : "ring-1 ring-inset ring-line")}>{on ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : null}</span>
                  </button>
                );
              })}
            </div>
            {ids.length < 2 ? <p className="caption mt-1">Pick at least two people.</p> : null}
          </section>
          <section className="card p-4">
            <p className="section mb-3">How</p>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Mode">
              {MODES.map((m) => <button key={m.key} type="button" role="radio" aria-checked={mode === m.key} onClick={() => setMode(m.key)} className={cn("pill", mode === m.key && "pill-on")} data-testid={`mode-${m.key}`}>{m.label}</button>)}
            </div>
            <p className="note mt-2">{MODES.find((m) => m.key === mode)?.blurb}</p>
          </section>
          <section className="card p-4">
            <p className="section mb-2">Plan</p>
            <button type="button" onClick={() => setSheet("occasion")} className="tap -mx-2 flex min-h-12 w-[calc(100%+16px)] items-center justify-between rounded-xl px-2 text-left" data-testid="together-plan">
              <span className={cn("text-[16px]", !planLabel && "text-graphite")}>{planLabel ?? "Pick an occasion"}</span>
              <span aria-hidden className="text-graphite">›</span>
            </button>
            <button type="button" onClick={() => setSheet("text")} className="pill pill-sm mt-2">Something else…</button>
          </section>
          <Button size="lg" className="w-full" busy={dressing} disabled={busy !== null || ids.length < 2} sub="One look for each person" onClick={dress} data-testid="dress-us">{dressing ? "Dressing…" : "Dress us"}</Button>
        </div>
      ) : null}

      {session && !editing ? (
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:gap-6" data-testid="together-boards">
          <p className="caption lg:col-span-3">{MODES.find((m) => m.key === session.mode)?.label ?? sentence(session.mode)}{session.occasionLabel ? ` · ${session.occasionLabel}` : ""}</p>
          {session.boards.map((b) => (
            <section key={b.personId} className="card flex flex-col gap-3 p-4" data-testid={`together-board-${b.personName}`}>
              <p className="section">{b.personName}</p>
              <div className="grid grid-cols-2 grid-rows-[150px_150px] gap-1.5">
                {[0, 1, 2, 3].map((i) => {
                  const piece = b.pieces[i];
                  return (
                    <div key={i} className={cn("stage overflow-hidden", i === 0 && "row-span-2")}>
                      {piece?.thumbKey ? <img src={`/api/photo/${piece.thumbKey}`} alt={piece.name} className="size-full object-contain p-2" loading="lazy" decoding="async" /> : piece ? <div className="flex size-full items-end p-2"><span className="caption">{piece.name}</span></div> : null}
                    </div>
                  );
                })}
              </div>
              <p className="caption">{b.pieces.map((x) => sentence(x.label)).join(" · ")}</p>
              <p className="text-[17px] leading-snug">{b.board.reason}</p>
              {!canDressIds.includes(b.personId) ? <p className="caption">{b.wornFitId ? `${b.personName} is wearing this` : `Only ${b.personName} (or a parent) can wear it`}</p> : null}
              {canDressIds.includes(b.personId) ? (
                b.wornFitId ? <Link href="/fits" className="pill h-[50px]">✓ Wearing this · see Fits</Link>
                : <Button className="w-full" busy={busy === `wear-${b.personId}`} disabled={busy !== null} onClick={() => run(`wear-${b.personId}`, () => wearTogetherAction(b.personId, b.suggestionId, session.occasionLabel ?? "Together"))} data-testid={`wear-${b.personName}`}>{busy === `wear-${b.personId}` ? "Saving…" : `Wear this · ${b.personName}`}</Button>
              ) : null}
            </section>
          ))}
          {/* A person who got no look is a line, not an absence (review D 8.2). */}
          {session.missing.map((m) => (
            <p key={m.personId} className="note" role="status" data-testid={`together-missing-${m.personName}`}>No look for {m.personName}: {m.reason}</p>
          ))}
          {session.boards.length === 0 ? <div className="flex flex-col items-start gap-3 lg:col-span-3"><p className="note">Nobody had enough clean pieces for a look.</p><Link href="/add" className="pill">+ Add clothes</Link></div> : null}
        </div>
      ) : null}

      {/* The wait card: what is happening, how long it has been, and that you can leave. */}
      {dressing ? (
        <div className="wait flex items-center gap-3" role="status" aria-live="polite" data-testid="together-wait">
          <span aria-hidden className="size-2.5 shrink-0 animate-pulse rounded-full bg-paper" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-semibold">Dressing everyone<span className="font-normal opacity-70"> · {secs}s</span></span>
            <span className="truncate text-[13px] opacity-80">{step ?? "Getting ready…"} · You can leave; the looks will be here.</span>
          </span>
        </div>
      ) : null}

      <PickSheet open={sheet === "occasion"} onClose={() => setSheet(null)} title="Occasion" kind="occasion" options={occasions} selected={occasionId ? [occasionId] : []} canAdd={isAdmin} onChange={(x) => { setOccasionId(x[0] ?? null); if (x[0]) setText(null); }} />
      <TextSheet open={sheet === "text"} onClose={() => setSheet(null)} title="What’s the plan?" label="Plan" value={text ?? ""} placeholder="Grandma’s birthday" onSave={(v) => { setText(v); setOccasionId(null); }} />
    </div>
  );
}

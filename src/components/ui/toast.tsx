"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

type Tone = "ok" | "error";
/** A way on from the toast: "Open the look →". */
type Action = { label: string; href: string };
type Toast = { id: number; text: string; tone: Tone; action?: Action };
const listeners = new Set<(t: Toast) => void>();
let seq = 0;
/** Toasts fired before any host is listening (a page's own effect runs before the layout's host subscribes): kept a few seconds and shown when the host arrives. */
const pending: { t: Toast; at: number }[] = [];
const PENDING_MS = 5000;
function emit(text: string, tone: Tone, action?: Action) {
  const t = { id: ++seq, text, tone, action };
  if (!listeners.size) { pending.push({ t, at: Date.now() }); return; }
  listeners.forEach((l) => l(t));
}
function subscribe(l: (t: Toast) => void) {
  listeners.add(l);
  const now = Date.now();
  for (const p of pending.splice(0)) if (now - p.at < PENDING_MS) l(p.t);
}

/**
 * `toast.error("Couldn't save. Try again.")` or `toast.ok("Saved")` from anywhere on the client; the host above the tab
 * bar shows it. `toast.ok("In the look", { label: "Open the look", href })` adds a link and stays longer (the owner,
 * 20 Nov 2026: "I clicked add to look but nothing happened": the word alone went by too fast).
 */
export const toast = { ok: (text: string, action?: Action) => emit(text, "ok", action), error: (text: string) => emit(text, "error") };

/** How long a toast stays: long enough to glance after a one-second action; errors and toasts with a way on stay longer. A tap dismisses any of them. */
const STAY_MS = { ok: 4000, long: 6000 };
const FIELD = /^(INPUT|TEXTAREA|SELECT)$/;

/** How much of the layout viewport the iOS keyboard covers while a field has focus (0 otherwise): the toast must sit above it. */
function keyboardInset(): number {
  const vv = window.visualViewport; const a = document.activeElement;
  if (!vv || !a || !FIELD.test(a.tagName)) return 0;
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  /** Where the toasts render: the open sheet when there is one, else the page. */
  const [host, setHost] = useState<HTMLElement | null>(null);
  /** Pixels above the usual spot: the keyboard, a wait card. */
  const [lift, setLift] = useState(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = (id: number) => {
    const t = timers.current.get(id); if (t) clearTimeout(t); timers.current.delete(id);
    setItems((x) => x.filter((i) => i.id !== id));
  };

  useEffect(() => {
    const l = (t: Toast) => {
      setItems((x) => [...x.slice(-1), t]);
      timers.current.set(t.id, setTimeout(() => dismiss(t.id), t.tone === "error" || t.action ? STAY_MS.long : STAY_MS.ok));
    };
    subscribe(l);
    return () => { listeners.delete(l); timers.current.forEach(clearTimeout); timers.current.clear(); };
  }, []);

  // A native <dialog> sits in the top layer above everything in the page, so a toast fired while a sheet is open must render
  // inside the sheet or nobody sees it ("Ask" in a pick sheet). The Sheet toggles html.sheet-open; watch that and re-home.
  useEffect(() => {
    const place = () => setHost(document.querySelector<HTMLElement>("dialog[open]") ?? document.body);
    place();
    const mo = new MutationObserver(place);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  // Keep clear of the keyboard and of a pinned wait card while anything shows.
  useEffect(() => {
    if (!items.length) return;
    const vv = window.visualViewport;
    const measure = () => { const wait = document.querySelector<HTMLElement>(".wait"); setLift(keyboardInset() + (wait ? wait.offsetHeight + 8 : 0)); };
    let t: ReturnType<typeof setTimeout> | undefined;
    const later = () => { clearTimeout(t); t = setTimeout(measure, 0); }; // focusout lands before the next field's focusin
    measure();
    vv?.addEventListener("resize", measure); vv?.addEventListener("scroll", measure);
    document.addEventListener("focusin", measure); document.addEventListener("focusout", later);
    return () => {
      clearTimeout(t);
      vv?.removeEventListener("resize", measure); vv?.removeEventListener("scroll", measure);
      document.removeEventListener("focusin", measure); document.removeEventListener("focusout", later);
    };
  }, [items.length]);

  const newest = items[items.length - 1];
  const ui = (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom)+12px+var(--toast-lift))] z-40 flex flex-col items-center gap-2 px-5 lg:bottom-[calc(24px+var(--toast-lift))]" style={{ "--toast-lift": `${lift}px` } as React.CSSProperties} data-testid="toasts">
      {/* One live region that stays mounted: VoiceOver reads text that changes inside an existing region far more reliably than a region that appears with the toast. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{newest ? newest.text : ""}</div>
      {items.map((t) => (
        <div key={t.id} onClick={() => dismiss(t.id)} data-testid={`toast-${t.tone}`} className={cn("pointer-events-auto flex w-full max-w-[440px] cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.18)]", t.tone === "error" ? "bg-paper text-ink ring-1 ring-inset ring-line" : "bg-ink text-paper")}>
          <span className="text-[14px] leading-snug">{t.tone === "error" ? "— " : "✓ "}{t.text}</span>
          {t.action ? <Link href={t.action.href} onClick={() => dismiss(t.id)} className="pill pill-sm shrink-0 bg-paper text-ink" data-testid="toast-action">{t.action.label} →</Link> : null}
        </div>
      ))}
    </div>
  );
  return host ? createPortal(ui, host) : null;
}

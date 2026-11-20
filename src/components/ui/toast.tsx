"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

type Tone = "ok" | "error";
/** A way on from the toast: "Open the look →". */
type Action = { label: string; href: string };
type Toast = { id: number; text: string; tone: Tone; action?: Action };
const listeners = new Set<(t: Toast) => void>();
let seq = 0;
function emit(text: string, tone: Tone, action?: Action) { const t = { id: ++seq, text, tone, action }; listeners.forEach((l) => l(t)); }

/**
 * `toast.error("Couldn't save. Try again.")` or `toast.ok("Saved")` from anywhere on the client; the host above the tab
 * bar shows it. `toast.ok("In the look", { label: "Open the look", href })` adds a link and stays longer (Jeff,
 * 20 Nov 2026: "I clicked add to look but nothing happened": the word alone went by too fast).
 */
export const toast = { ok: (text: string, action?: Action) => emit(text, "ok", action), error: (text: string) => emit(text, "error") };

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l = (t: Toast) => {
      setItems((x) => [...x.slice(-1), t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), t.tone === "error" ? 6000 : t.action ? 6000 : 2500);
    };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom)+12px)] z-40 flex flex-col items-center gap-2 px-5 lg:bottom-6" data-testid="toasts">
      {items.map((t) => (
        <div key={t.id} role={t.tone === "error" ? "alert" : "status"} data-testid={`toast-${t.tone}`} className={cn("pointer-events-auto flex w-full max-w-[440px] items-center justify-between gap-3 border border-ink px-4 py-3 shadow-[0_4px_0_0_var(--color-stone)]", t.tone === "error" ? "bg-paper text-ink" : "bg-ink text-paper")}>
          <span className="text-[14px] leading-snug">{t.tone === "error" ? "— " : "✓ "}{t.text}</span>
          {t.action ? <Link href={t.action.href} onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} className="pill pill-sm shrink-0 border-paper bg-paper text-ink" data-testid="toast-action">{t.action.label} →</Link> : null}
        </div>
      ))}
    </div>
  );
}

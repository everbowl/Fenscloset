"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

type Tone = "ok" | "error";
type Toast = { id: number; text: string; tone: Tone };
const listeners = new Set<(t: Toast) => void>();
let seq = 0;
function emit(text: string, tone: Tone) { const t = { id: ++seq, text, tone }; listeners.forEach((l) => l(t)); }

/** `toast.error("Couldn't save. Try again.")` or `toast.ok("Saved")` from anywhere on the client; the host above the tab bar shows it. */
export const toast = { ok: (text: string) => emit(text, "ok"), error: (text: string) => emit(text, "error") };

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l = (t: Toast) => {
      setItems((x) => [...x.slice(-1), t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), t.tone === "error" ? 6000 : 2500);
    };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom)+12px)] z-40 flex flex-col items-center gap-2 px-5 lg:bottom-6" data-testid="toasts">
      {items.map((t) => (
        <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className={cn("mono pointer-events-auto max-w-[440px] border border-ink px-4 py-3 shadow-[0_4px_0_0_var(--color-stone)]", t.tone === "error" ? "bg-paper text-ink" : "bg-ink text-paper")} data-testid={`toast-${t.tone}`}>
          {t.tone === "error" ? "— " : "✓ "}{t.text}
        </div>
      ))}
    </div>
  );
}

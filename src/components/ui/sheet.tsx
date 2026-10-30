"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

/** Bottom sheet on phones, centered on wide screens. Square, ruled, native <dialog>. Slides up in a beat (globals.css); the page behind it stays put. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; /** Pinned under the scrolling body: the one button that matters. */ footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  // Lock the page while any sheet is open (counted, so nested or sibling sheets keep it locked until the last one closes).
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const n = Number(html.dataset.sheets ?? "0") + 1;
    html.dataset.sheets = String(n); html.classList.add("sheet-open");
    return () => { const left = Number(html.dataset.sheets ?? "1") - 1; html.dataset.sheets = String(Math.max(0, left)); if (left <= 0) html.classList.remove("sheet-open"); };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // The native close event also fires when we close programmatically; only report user dismissals (Esc).
      onClose={() => { if (openRef.current) onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="sheet m-0 h-auto max-h-[90dvh] w-full max-w-none self-end justify-self-center bg-paper text-ink sm:max-w-[420px] sm:self-center sm:border sm:border-ink"
    >
      <div aria-hidden className="mx-auto mt-2 h-1 w-9 bg-graphite/60 sm:hidden" />
      <div className="flex h-14 items-center justify-between border-b border-ink px-5">
        <h2 id={titleId} className="serif text-[24px]">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-3 flex size-11 items-center justify-center active:text-graphite">
          <X className="size-[18px]" strokeWidth={1.6} />
        </button>
      </div>
      <div className={footer ? "max-h-[calc(90dvh-3.5rem-4.5rem)] overflow-y-auto px-5 py-5" : "safe-bottom max-h-[calc(90dvh-3.5rem)] overflow-y-auto px-5 py-5"}>{children}</div>
      {footer ? <div className="safe-bottom border-t border-line bg-paper px-5 py-3">{footer}</div> : null}
    </dialog>
  );
}

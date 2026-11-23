"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

const FIELD = /^(INPUT|TEXTAREA|SELECT)$/;
const DISMISS_PX = 80;

/** Bottom sheet on phones, centered on wide screens. Native <dialog>. Slides up in a beat (globals.css); the page behind it stays put. Drag the top down to close it. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; /** Pinned under the scrolling body: the one button that matters. */ footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const titleId = useId();
  const drag = useRef<{ y: number; dy: number } | null>(null);

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
    // Older iOS scrolls the page through the backdrop despite overflow: hidden; refusing touches on the body behind the sheet stops
    // it. The sheet's own body still scrolls: touch-action is read from the touched element up to its nearest scroller, which is inside the sheet.
    document.body.style.touchAction = "none";
    return () => {
      const left = Number(html.dataset.sheets ?? "1") - 1; html.dataset.sheets = String(Math.max(0, left));
      if (left <= 0) { html.classList.remove("sheet-open"); document.body.style.touchAction = ""; }
    };
  }, [open]);
  // iOS does not shrink the layout viewport for the keyboard, so a bottom sheet (and its Save) can sit under it. While a field
  // inside the sheet has focus, size the sheet to the visual viewport and lift it by the keyboard's height.
  useEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!open || !el || !vv) return;
    let field = false;
    const apply = () => {
      // Only while a keyboard is really up (the visual viewport is well short of the window): with none, leaving the styles alone
      // keeps the sheet's height steady, so a button does not move under a finger between the press and the release (23 Nov 2026:
      // the Create invite tap landed on the form's padding after the Email field lost focus and the sheet snapped back).
      const keyboard = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      if (!field || keyboard < 80) { el.style.maxHeight = ""; el.style.marginBottom = ""; return; }
      el.style.maxHeight = `${Math.round(vv.height)}px`;
      el.style.marginBottom = `${Math.max(0, keyboard)}px`;
    };
    const check = () => { const a = document.activeElement; field = Boolean(a && el.contains(a) && FIELD.test(a.tagName)); apply(); };
    let t: ReturnType<typeof setTimeout> | undefined;
    const later = () => { clearTimeout(t); t = setTimeout(check, 0); }; // focusout fires before the next field's focusin
    el.addEventListener("focusin", check); el.addEventListener("focusout", later);
    vv.addEventListener("resize", apply); vv.addEventListener("scroll", apply);
    check();
    return () => {
      clearTimeout(t);
      el.removeEventListener("focusin", check); el.removeEventListener("focusout", later);
      vv.removeEventListener("resize", apply); vv.removeEventListener("scroll", apply);
      el.style.maxHeight = ""; el.style.marginBottom = "";
    };
  }, [open]);

  // The handle promises a swipe down; this keeps it. The sheet follows the finger and closes past 80 px; a button in the header is left alone.
  function dragStart(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { y: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function dragMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current; const el = ref.current;
    if (!d || !el) return;
    d.dy = Math.max(0, e.clientY - d.y);
    el.style.transform = d.dy ? `translateY(${d.dy}px)` : "";
  }
  function dragEnd() {
    const d = drag.current; const el = ref.current;
    drag.current = null;
    if (el) el.style.transform = "";
    if (d && d.dy > DISMISS_PX) onClose();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={open ? titleId : undefined}
      // The native close event also fires when we close programmatically; only report user dismissals (Esc).
      onClose={() => { if (openRef.current) onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      // Anchored with auto margins (height: fit-content, margin-top: auto), which every engine has honored for years; `self-end` on a
      // top-layer dialog needed WebKit 17.4 and left older iPhones with a sheet stuck to the top.
      className="sheet mx-auto mt-auto mb-0 h-fit max-h-[90dvh] w-full max-w-none flex-col bg-paper text-ink open:flex sm:my-auto sm:max-w-[420px] sm:border sm:border-ink"
    >
      <div onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd} className="shrink-0 touch-none select-none">
        <div aria-hidden className="mx-auto mt-2 h-1 w-9 bg-graphite/60 sm:hidden" />
        <div className="flex h-14 items-center justify-between border-b border-ink px-5">
          <h2 id={titleId} className="serif text-[24px]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-3 flex size-11 items-center justify-center active:text-graphite">
            <X className="size-[18px]" strokeWidth={1.6} />
          </button>
        </div>
      </div>
      {/* The body takes what is left of the 90dvh and scrolls; the header and the footer (the one button that matters) always stay in view.
          `flex-auto`, not `flex-1`: the dialog's height is its content's, and Safari sizes a `flex: 1 1 0%` child of an auto-height
          column to nothing, so the sheet opened empty on iPhones (Jeff, 22 Nov 2026, the mirror). Chromium, and so the suites, never showed it. */}
      <div className={footer ? "min-h-0 flex-auto overflow-y-auto px-5 py-5" : "safe-bottom min-h-0 flex-auto overflow-y-auto px-5 py-5"}>{children}</div>
      {footer ? <div className="safe-bottom shrink-0 border-t border-line bg-paper px-5 py-3">{footer}</div> : null}
    </dialog>
  );
}

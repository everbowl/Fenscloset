"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** Bottom sheet on mobile, centered dialog on desktop. Native <dialog> for focus trapping and Escape. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="m-0 h-auto max-h-[90dvh] w-full max-w-none self-end justify-self-center rounded-t-3xl border-0 bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/40 sm:max-w-md sm:self-center sm:rounded-2xl"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <h2 className="text-base font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 rounded-full p-2 hover:bg-stone-100">
          <X className="size-5" />
        </button>
      </div>
      <div className="safe-bottom max-h-[calc(90dvh-3.5rem)] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}

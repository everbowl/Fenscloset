"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** Bottom sheet on phones, centered on wide screens. Square, ruled, native <dialog>. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // The native close event also fires when we close programmatically; only report user dismissals (Esc).
      onClose={() => { if (openRef.current) onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="sheet m-0 h-auto max-h-[90dvh] w-full max-w-none self-end justify-self-center bg-paper text-ink sm:max-w-[420px] sm:self-center sm:border sm:border-ink"
    >
      <div className="flex h-14 items-center justify-between border-b border-ink px-5">
        <h2 className="serif text-[24px]">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-3 flex size-11 items-center justify-center">
          <X className="size-[18px]" strokeWidth={1.6} />
        </button>
      </div>
      <div className="safe-bottom max-h-[calc(90dvh-3.5rem)] overflow-y-auto px-5 py-5">{children}</div>
    </dialog>
  );
}

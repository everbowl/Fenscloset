import type { ReactNode } from "react";

/** Mono uppercase label above an underline input, as on the sign-in mockup. */
export function Field({ label, htmlFor, hint, error, children }: {
  label: string; htmlFor?: string; hint?: string; error?: string; children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="mono tracking-[0.14em] text-graphite">{label}</label>
      {children}
      {error ? <p className="mono mt-1 border-t border-ink pt-2 text-ink" role="alert">— {error}</p>
        : hint ? <p className="mono normal-case tracking-[0.08em] text-[11px] text-graphite pt-1">{hint}</p> : null}
    </div>
  );
}

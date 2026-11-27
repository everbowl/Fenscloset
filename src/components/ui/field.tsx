import type { ReactNode } from "react";

/** A small label above an underline input, with a hint or an error under it. */
export function Field({ label, htmlFor, hint, error, children }: {
  label: string; htmlFor?: string; hint?: string; error?: string; children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="mono text-graphite">{label}</label>
      {children}
      {error ? <p className="mono mt-1 border-t border-ink pt-2 text-ink" role="alert">— {error}</p>
        : hint ? <p className="note pt-1">{hint}</p> : null}
    </div>
  );
}

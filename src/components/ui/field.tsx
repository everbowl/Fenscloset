import type { ReactNode } from "react";

export function Field({ label, htmlFor, hint, error, children }: {
  label: string; htmlFor?: string; hint?: string; error?: string; children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">{label}</label>
      {children}
      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

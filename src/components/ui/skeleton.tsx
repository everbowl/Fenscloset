import { cn } from "@/lib/cn";

/** A bone block standing in for something still loading. Pulses gently; still under reduced motion. */
export function Block({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse bg-bone motion-reduce:animate-none", className)} />;
}

/** The wrapper every loading screen uses: tells screen readers once, draws nothing else. */
export function Loading({ children, label = "Loading" }: { children: React.ReactNode; label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" data-testid="loading">
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

/** The title block most screens open with. */
export function TitleSkeleton({ eyebrow }: { eyebrow?: boolean }) {
  return (
    <div className="mb-4">
      {eyebrow ? <Block className="mb-3 h-3 w-32" /> : null}
      <div className="flex items-end justify-between"><Block className="h-10 w-44" /><Block className="h-3 w-16" /></div>
    </div>
  );
}

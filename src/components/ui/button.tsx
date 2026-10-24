"use client";

import { cn } from "@/lib/cn";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "sm";

/*
 * Brand buttons (Jeff, 19 Oct 2026, Q11 A + C + D + motion): pills in the household accent (real orange,
 * editable in Admin → Rules) sitting on a stone base; big ones carry a line icon and a second line that says
 * what happens next, and sit on a bone shelf. Press: the pill sinks onto its base and the arrow slides.
 * Done: a quick black "✓ …" flash. The big button rises in a beat after the page. Everything else on the
 * page stays black and white; secondary is a 1px black outline pill.
 */
export const LIFT = "shadow-[0_6px_0_0_var(--color-stone)] active:translate-y-[4px] active:shadow-[0_2px_0_0_var(--color-stone)] transition-[transform,box-shadow,background-color,filter] duration-100 disabled:shadow-none disabled:translate-y-0";
/** The bone band a big button sits on (Q11 D "warm paper"). It wraps the button rather than being a pseudo on it: the button animates (a stacking context of its own), and a -z pseudo inside it would paint over the orange. */
export const SHELF = "block relative before:absolute before:-inset-x-5 before:-inset-y-3 before:-z-10 before:bg-bone before:content-['']";
export function Shelf({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn(SHELF, className)}>{children}</span>;
}
const variants: Record<Variant, string> = {
  primary: `bg-accent text-paper hover:brightness-95 active:brightness-90 disabled:bg-neutral-400 ${LIFT}`,
  secondary: "bg-paper text-ink border border-ink hover:bg-bone active:bg-line active:translate-y-[1px]",
  ghost: "bg-transparent text-ink hover:text-graphite",
  danger: "bg-paper text-ink border border-ink hover:bg-bone active:bg-line",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-[10px] tracking-[0.14em]",
  md: "h-[46px] px-5 text-[11px] tracking-[0.14em]",
  lg: "min-h-[58px] px-6 text-[12px] tracking-[0.16em]",
};

/** The classes of a button, for a Link that must look like one. */
export function buttonClass(opts: { variant?: Variant; size?: Size; className?: string } = {}): string {
  const variant = opts.variant ?? "primary"; const size = opts.size ?? "md";
  const big = variant === "primary" && size === "lg";
  return cn(
    "group inline-flex items-center justify-center gap-3 whitespace-nowrap rounded-full font-mono uppercase select-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60",
    variants[variant], sizes[size], big && "rise", opts.className,
  );
}

export function Button({
  className, variant = "primary", size = "md", type = "button", shelf, arrow, icon, sub, flash, children, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: Size;
  /** bone band behind the button; default on for large primaries */ shelf?: boolean;
  /** "→" after the label; default on for large primaries without a sub line */ arrow?: boolean;
  /** a line icon at the left (Q11 C) */ icon?: ReactNode;
  /** the second line: what happens next (Q11 C) */ sub?: string;
  /** when set, shows for a beat in black, e.g. "✓ Worn" (Q11 motion) */ flash?: string | null;
}) {
  const big = variant === "primary" && size === "lg";
  const withArrow = arrow ?? (big && !sub);
  const [showFlash, setShowFlash] = useState(false);
  useEffect(() => {
    if (!flash) return;
    setShowFlash(true);
    const t = setTimeout(() => setShowFlash(false), 900);
    return () => clearTimeout(t);
  }, [flash]);
  const withShelf = shelf ?? big;
  const inner = (
    <button type={type} className={cn(buttonClass({ variant, size, className }), showFlash && "bg-ink text-paper hover:brightness-100")} {...props}>
      {showFlash ? <span data-testid="button-flash">{flash}</span> : (
        <>
          {icon ? <span aria-hidden className="shrink-0">{icon}</span> : null}
          {sub ? (
            <span className="flex min-w-0 flex-col items-start gap-0.5 text-left normal-case tracking-normal">
              <span className="font-mono uppercase tracking-[0.16em]">{children}</span>
              <span className="mono text-[9px] tracking-[0.12em] opacity-75">{sub}</span>
            </span>
          ) : children}
          {withArrow ? <span aria-hidden className="ml-1 transition-transform duration-100 group-active:translate-x-1">→</span> : null}
        </>
      )}
    </button>
  );
  return withShelf ? <Shelf>{inner}</Shelf> : inner;
}

/** Line icons for the big buttons: the same stroke as the rest of the app. */
const ICON = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
export const Icons = {
  shirt: () => <svg {...ICON}><path d="M8 4l4 2 4-2 5 3-2 4-2-1v10H7V10l-2 1-2-4z" /></svg>,
  check: () => <svg {...ICON}><path d="M5 12l5 5L20 7" /></svg>,
  camera: () => <svg {...ICON}><path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13.5" r="3.5" /></svg>,
  calendar: () => <svg {...ICON}><rect x="3" y="5" width="18" height="16" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  copy: () => <svg {...ICON}><rect x="9" y="9" width="12" height="12" /><path d="M5 15V3h12" /></svg>,
};

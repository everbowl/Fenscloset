"use client";

import { cn } from "@/lib/cn";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { buttonClass, LIFT, type Size, type Variant } from "./button-class";

/*
 * Brand buttons (Jeff, 19 Oct 2026, Q11 A + C + D + motion): pills in the household accent (real orange,
 * editable in Admin → Rules) sitting on a stone base; big ones carry a line icon and a second line that says
 * what happens next, and sit on a bone shelf. Press: the pill sinks onto its base and the arrow slides.
 * Done: a quick black "✓ …" flash. The big button rises in a beat after the page. Everything else on the
 * page stays black and white: secondary is a solid black pill (Jeff, 23 Oct 2026: "all buttons should be
 * louder and apparent"; it was a 1px outline), danger an outlined one, and every text action on a screen
 * is a .pill (globals.css) so that anything tappable reads as a button.
 */
export { buttonClass, LIFT };
/** The bone band a big button sits on (Q11 D "warm paper"). It wraps the button rather than being a pseudo on it: the button animates (a stacking context of its own), and a -z pseudo inside it would paint over the orange. */
export const SHELF = "block relative before:absolute before:-inset-x-5 before:-inset-y-3 before:-z-10 before:bg-bone before:content-['']";
export function Shelf({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn(SHELF, className)}>{children}</span>;
}

export function Button({
  className, variant = "primary", size = "md", type = "button", shelf, arrow, icon, sub, flash, busy, disabled, children, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: Size;
  /** Working on it: the button waits (no second tap) but keeps its color, with a moving dot; disabled gray is for "can't", not "saving". */ busy?: boolean;
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
  // Width and flex classes belong to the outermost box: on the shelf when there is one, so `flex-1` and `w-full` still work.
  const parts = (className ?? "").split(/\s+/).filter(Boolean);
  const layout = parts.filter((c) => /^(flex-1|w-full|grow|shrink-0|self-\w+|mt-\d+|mb-\d+|lg:col-start-\d|lg:w-\w+)$/.test(c));
  const own = parts.filter((c) => !layout.includes(c));
  const inner = (
    <button type={type} disabled={disabled || busy} aria-busy={busy || undefined}
      className={cn(buttonClass({ variant, size, className: cn(own.join(" "), withShelf && layout.length ? "w-full" : layout.join(" ")) }), showFlash && "bg-ink text-paper hover:brightness-100", busy && "disabled:opacity-100 disabled:bg-accent disabled:text-ink disabled:shadow-[0_6px_0_0_var(--color-stone)] disabled:translate-y-0 disabled:cursor-progress", busy && variant === "secondary" && "disabled:bg-ink disabled:text-paper")} {...props}>
      {showFlash ? <span data-testid="button-flash">{flash}</span> : (
        <>
          {busy ? <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-current" /> : icon ? <span aria-hidden className="shrink-0">{icon}</span> : null}
          {sub ? (
            <span className="flex min-w-0 flex-col items-start gap-0.5 text-left normal-case tracking-normal">
              <span className="font-mono uppercase tracking-[0.16em]">{children}</span>
              <span className="mono text-[11px] tracking-[0.12em]">{sub}</span>
            </span>
          ) : children}
          {withArrow && !busy ? <span aria-hidden className="ml-1 transition-transform duration-100 group-active:translate-x-1">→</span> : null}
        </>
      )}
    </button>
  );
  return withShelf ? <Shelf className={layout.join(" ")}>{inner}</Shelf> : inner;
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

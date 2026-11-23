"use client";

import { cn } from "@/lib/cn";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { buttonClass, type Size, type Variant } from "./button-class";

/*
 * Brand buttons (Jeff, 19 Oct 2026, Q11 A + C + D + motion, restyled for v2 on 23 Nov 2026): pills in the household accent
 * (real orange, editable in Admin → Rules); big ones carry a line icon and a second line that says what happens next. Press:
 * the pill dips and the arrow slides. Done: a quick black "✓ …" flash. The big button rises in a beat after the page.
 * Everything else on the page stays black and white: secondary is a solid black pill (Jeff, 23 Oct 2026: "all buttons
 * should be louder and apparent"; it was a 1px outline), danger an outlined one, and every text action on a screen is a
 * .pill (globals.css) so that anything tappable reads as a button.
 */
export { buttonClass };

/* Busy keeps the button's own color (disabled gray is for "can't", not "saving"); the dot does the talking. */
const busyKeep: Record<Variant, string> = {
  primary: "disabled:bg-accent disabled:text-ink",
  secondary: "disabled:bg-ink disabled:text-paper",
  outline: "disabled:bg-bone disabled:text-ink",
  ghost: "disabled:bg-transparent disabled:text-ink",
  danger: "disabled:bg-paper disabled:text-danger",
};

export function Button({
  className, variant = "primary", size = "md", type = "button", shelf: _shelf, arrow, icon, sub, flash, busy, disabled, children, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: Size;
  /** Working on it: the button waits (no second tap) but keeps its color, with a moving dot; disabled gray is for "can't", not "saving". */ busy?: boolean;
  /** @deprecated v2 has no bone shelf; accepted and ignored until the four callers that pass shelf={false} drop it. */ shelf?: boolean;
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
  return (
    <button type={type} disabled={disabled || busy} aria-busy={busy || undefined}
      className={cn(buttonClass({ variant, size, className }), showFlash && "bg-ink text-paper hover:brightness-100", busy && cn("disabled:opacity-100 disabled:cursor-progress", busyKeep[variant]))} {...props}>
      {showFlash ? <span data-testid="button-flash">{flash}</span> : (
        <>
          {busy ? <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-current motion-reduce:animate-none" /> : icon ? <span aria-hidden className="shrink-0">{icon}</span> : null}
          {sub ? (
            <span className="flex min-w-0 flex-col items-start gap-0 text-left">
              <span className="text-[16px] font-semibold leading-tight">{children}</span>
              <span className="text-[13px] font-medium leading-tight opacity-75">{sub}</span>
            </span>
          ) : children}
          {withArrow && !busy ? <span aria-hidden className="ml-1 transition-transform duration-100 group-active:translate-x-1">→</span> : null}
        </>
      )}
    </button>
  );
}

/** Line icons for the big buttons: the same stroke as the rest of the app. */
const ICON = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
export const Icons = {
  shirt: () => <svg {...ICON}><path d="M8 4l4 2 4-2 5 3-2 4-2-1v10H7V10l-2 1-2-4z" /></svg>,
  check: () => <svg {...ICON}><path d="M5 12l5 5L20 7" /></svg>,
  camera: () => <svg {...ICON}><path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13.5" r="3.5" /></svg>,
  calendar: () => <svg {...ICON}><rect x="3" y="5" width="18" height="16" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  copy: () => <svg {...ICON}><rect x="9" y="9" width="12" height="12" /><path d="M5 15V3h12" /></svg>,
  link: () => <svg {...ICON}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" /></svg>,
};

import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "sm";

/*
 * Brand buttons: square, mono uppercase, tracked. Primary is the household's accent (real orange, Jeff 19 Oct 2026, Q11 A;
 * editable in Admin → Rules); secondary is a 1px black outline. Everything else on the page stays black and white.
 * Primary gets a "lift" (Jeff, 19 Oct 2026, Q1 A): a second black edge sitting down and to the right with a
 * paper gap, so it reads as a thing to press and not as another block of type. Large primaries also sit
 * on a bone "shelf" (Q1 B) that reaches into the page gutter, and carry an arrow.
 */
export const LIFT = "shadow-[4px_4px_0_0_var(--color-paper),5px_5px_0_1px_var(--color-ink)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_var(--color-paper),3px_3px_0_1px_var(--color-ink)] disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0";
export const SHELF = "relative before:absolute before:-inset-x-5 before:-inset-y-3 before:-z-10 before:bg-bone before:content-['']";
const variants: Record<Variant, string> = {
  primary: `bg-accent text-paper hover:brightness-95 active:brightness-90 disabled:bg-neutral-400 ${LIFT}`,
  secondary: "bg-paper text-ink border border-ink hover:bg-bone active:bg-line",
  ghost: "bg-transparent text-ink hover:text-graphite",
  danger: "bg-paper text-ink border border-ink hover:bg-bone active:bg-line",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-[10px] tracking-[0.14em]",
  md: "h-[46px] px-4 text-[11px] tracking-[0.14em]",
  lg: "h-[58px] px-5 text-[12px] tracking-[0.16em]",
};

export function Button({
  className, variant = "primary", size = "md", type = "button", shelf, arrow, children, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; /** bone band behind the button; default on for large primaries */ shelf?: boolean; /** "→" after the label; default on for large primaries */ arrow?: boolean }) {
  const big = variant === "primary" && size === "lg";
  const withShelf = shelf ?? big;
  const withArrow = arrow ?? big;
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap font-mono uppercase transition-[colors,transform,box-shadow] select-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant], sizes[size], withShelf && SHELF, className,
      )}
      {...props}
    >
      {children}
      {withArrow ? <span aria-hidden className="ml-1">→</span> : null}
    </button>
  );
}

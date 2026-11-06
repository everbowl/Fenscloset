import { cn } from "@/lib/cn";

export type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type Size = "md" | "lg" | "sm";

/** No "use client" here on purpose: server pages (All done, Shop) render Links that must look like the big button. */
export const LIFT = "shadow-[0_6px_0_0_var(--color-stone)] active:translate-y-[4px] active:shadow-[0_2px_0_0_var(--color-stone)] transition-[transform,box-shadow,background-color,filter] duration-100 disabled:shadow-none disabled:translate-y-0";
const variants: Record<Variant, string> = {
  // Black on the accent (Jeff, 31 Oct 2026, B1): white on this orange failed the contrast rule.
  primary: `bg-accent text-ink hover:brightness-95 active:brightness-90 disabled:bg-neutral-400 disabled:text-paper ${LIFT}`,
  secondary: "bg-ink text-paper hover:bg-graphite active:bg-ink active:translate-y-[1px] disabled:bg-neutral-400 disabled:text-paper",
  // Next to an orange button every other button is outlined, so orange stands alone (D1).
  outline: "bg-paper text-ink border-2 border-ink hover:bg-bone active:bg-line active:translate-y-[1px] disabled:bg-paper",
  ghost: "bg-transparent text-ink hover:text-graphite",
  danger: "bg-paper text-ink border-2 border-ink hover:bg-bone active:bg-line",
};
const sizes: Record<Size, string> = {
  sm: "h-10 px-4 text-[11px] tracking-[0.14em]",
  md: "h-[50px] px-6 text-[12px] tracking-[0.14em]",
  lg: "min-h-[60px] px-7 text-[13px] tracking-[0.16em]",
};

/** The classes of a button, for a Link that must look like one. */
export function buttonClass(opts: { variant?: Variant; size?: Size; className?: string } = {}): string {
  const variant = opts.variant ?? "primary"; const size = opts.size ?? "md";
  const big = variant === "primary" && size === "lg";
  return cn(
    "group inline-flex items-center justify-center gap-3 whitespace-nowrap rounded-full font-mono font-medium uppercase select-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60",
    variants[variant], sizes[size], big && "rise", opts.className,
  );
}

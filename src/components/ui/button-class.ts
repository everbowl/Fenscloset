import { cn } from "@/lib/cn";

export type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type Size = "md" | "lg" | "sm";

/** No "use client" here on purpose: server pages (All done, Shop) render Links that must look like the big button. */
const variants: Record<Variant, string> = {
  // The one colored button on a screen. Black on the household's orange (the owner, 31 Oct 2026, B1).
  primary: "bg-accent text-ink hover:brightness-95 active:brightness-90 active:scale-[0.99] disabled:bg-neutral-300 disabled:text-paper",
  secondary: "bg-ink text-paper hover:bg-neutral-800 active:bg-ink active:scale-[0.99] disabled:bg-neutral-300 disabled:text-paper",
  // Next to the colored button every other button is quiet gray, so the colored one stands alone (D1).
  outline: "bg-bone text-ink hover:bg-[#ebeae6] active:bg-[#e2e1dc] active:scale-[0.99] disabled:bg-bone",
  ghost: "bg-transparent text-ink hover:text-graphite",
  danger: "bg-paper text-danger ring-1 ring-inset ring-line hover:bg-bone active:bg-[#e2e1dc]",
};
const sizes: Record<Size, string> = {
  // Small stays 40px to the eye and 50px to the finger: the hit area reaches 5px past each edge, as .pill-sm does.
  sm: "relative h-10 px-4 text-[14px] after:absolute after:-inset-[5px]",
  md: "h-12 px-5 text-[15px]",
  lg: "min-h-[54px] px-6 text-[16px]",
};

/** The classes of a button, for a Link that must look like one. */
export function buttonClass(opts: { variant?: Variant; size?: Size; className?: string } = {}): string {
  const variant = opts.variant ?? "primary"; const size = opts.size ?? "md";
  const big = variant === "primary" && size === "lg";
  return cn(
    "group inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-full font-sans font-semibold select-none transition-[transform,background-color,filter] duration-100",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60",
    variants[variant], sizes[size], big && "rise", opts.className,
  );
}

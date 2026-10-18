import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "sm";

/* Brand buttons: square, mono uppercase, tracked. Primary is solid black; secondary is a 1px black outline. */
const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-neutral-800 active:bg-neutral-900 disabled:bg-neutral-400",
  secondary: "bg-paper text-ink border border-ink hover:bg-bone active:bg-line",
  ghost: "bg-transparent text-ink hover:text-graphite",
  danger: "bg-paper text-ink border border-ink hover:bg-bone active:bg-line",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-[10px] tracking-[0.14em]",
  md: "h-[46px] px-4 text-[11px] tracking-[0.14em]",
  lg: "h-[54px] px-5 text-[12px] tracking-[0.16em]",
};

export function Button({
  className, variant = "primary", size = "md", type = "button", ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap font-mono uppercase transition-colors select-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant], sizes[size], className,
      )}
      {...props}
    />
  );
}

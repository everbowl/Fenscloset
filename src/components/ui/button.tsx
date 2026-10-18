import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "sm";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-foreground hover:bg-amber-800 active:bg-amber-900 disabled:bg-stone-300",
  secondary: "bg-surface text-foreground border border-border hover:bg-stone-50 active:bg-stone-100",
  ghost: "bg-transparent text-foreground hover:bg-stone-100 active:bg-stone-200",
  danger: "bg-danger text-white hover:bg-red-800 active:bg-red-900",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm rounded-lg",
  md: "h-11 px-4 text-[15px] rounded-xl",
  lg: "h-12 px-5 text-base rounded-xl",
};

export function Button({
  className, variant = "primary", size = "md", type = "button", ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-colors select-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-70",
        variants[variant], sizes[size], className,
      )}
      {...props}
    />
  );
}

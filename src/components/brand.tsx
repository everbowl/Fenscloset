import { cn } from "@/lib/cn";

/** The door-ajar mark from the brand sheet. */
export function Mark({ className, color = "currentColor" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 60 96" className={className} aria-hidden="true">
      <defs>
        <clipPath id="fc-mark"><path d="M0 96V30a30 30 0 0 1 60 0v66z" /></clipPath>
      </defs>
      <g clipPath="url(#fc-mark)" fill={color}>
        <rect x="0" y="0" width="36" height="96" />
        <rect x="39.5" y="0" width="20.5" height="96" />
      </g>
    </svg>
  );
}

export function Wordmark({ className, withMark = false, size = "sm" }: { className?: string; withMark?: boolean; size?: "sm" | "md" }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      {withMark ? <Mark className={size === "md" ? "h-[22px] w-[14px]" : "h-[18px] w-[11px]"} /> : null}
      <span className={cn("wordmark", size === "md" ? "text-[15px] tracking-[0.2em]" : "text-[12px]")}>Fen&rsquo;s Closet</span>
    </span>
  );
}

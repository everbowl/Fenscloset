import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type Tone = "danger" | "info" | "success";
/* Status is shown with words, never color: all tones are black rules; success sits on bone. */
const tones: Record<Tone, string> = {
  danger: "border-ink text-ink",
  info: "border-ink text-ink",
  success: "border-ink text-ink bg-bone",
};

/** Ruled notice in the brand's mono voice. */
export function Banner({ tone = "info", title, children, className }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("border-y px-0 py-3", tones[tone], className)}>
      {title ? <p className="mono mono-11 font-medium">— {title}</p> : null}
      {children ? <div className={cn("text-[14px] leading-snug", title && "mt-1")}>{children}</div> : null}
    </div>
  );
}

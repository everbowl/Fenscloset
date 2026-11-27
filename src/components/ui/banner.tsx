import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type Tone = "danger" | "info" | "success";

/** Ruled notice. Status is shown with words, never color: every tone is black rules; success sits on bone; danger is announced at once. */
export function Banner({ tone = "info", title, children, className }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("border-y border-ink px-0 py-3 text-ink", tone === "success" && "bg-bone", className)}>
      {title ? <p className="mono mono-11 font-medium">— {title}</p> : null}
      {children ? <div className={cn("text-[14px] leading-snug", title && "mt-1")}>{children}</div> : null}
    </div>
  );
}

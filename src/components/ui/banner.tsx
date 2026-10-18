import { cn } from "@/lib/cn";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";

type Tone = "danger" | "info" | "success";
const tones: Record<Tone, string> = {
  danger: "bg-red-50 border-red-200 text-red-900",
  info: "bg-amber-50 border-amber-200 text-amber-900",
  success: "bg-green-50 border-green-200 text-green-900",
};
const icons: Record<Tone, ReactNode> = {
  danger: <AlertTriangle className="size-5 shrink-0" aria-hidden />,
  info: <Info className="size-5 shrink-0" aria-hidden />,
  success: <CheckCircle2 className="size-5 shrink-0" aria-hidden />,
};

export function Banner({ tone = "info", title, children, className }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm", tones[tone], className)}>
      {icons[tone]}
      <div>
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : ""}>{children}</div> : null}
      </div>
    </div>
  );
}

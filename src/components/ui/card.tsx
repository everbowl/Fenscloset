import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]", className)} {...props} />;
}

import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

/** Square panel ruled with the hairline. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border border-line bg-paper p-4", className)} {...props} />;
}

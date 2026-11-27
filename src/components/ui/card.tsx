import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

/** A v2 card: white, a hairline, 16px corners (.card in globals.css), padded. Callers' classes come after and win. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card p-4", className)} {...props} />;
}

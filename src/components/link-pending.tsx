"use client";

import { useLinkStatus } from "next/link";
import { cn } from "@/lib/cn";

/** Inside a <Link>: wraps the label and pulses it while that link's navigation is in flight, so a tap always answers at once. */
export function LinkPending({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useLinkStatus();
  return <span data-pending={pending || undefined} className={cn(className, pending && "animate-pulse motion-reduce:animate-none")}>{children}</span>;
}

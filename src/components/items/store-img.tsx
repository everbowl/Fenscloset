"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * A store's own picture, hot-linked. Many stores refuse hot-links and http:// pictures are blocked on an https page,
 * which used to leave a blank bone box with no word about it (review B E5). When the picture will not show, the box
 * says whether a photo exists: the server fetches it on its own when the piece is added, so "no preview" is not
 * "no photo".
 */
export function StoreImg({ src, className, imgClassName, testId, note = "fetched" }: {
  src: string | null | undefined; className?: string; imgClassName?: string; testId?: string;
  /** What to say when the picture will not show: "fetched" (it will be fetched when added), "preview" (just no preview here). */
  note?: "fetched" | "preview";
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  const words = !src ? "No photo" : note === "fetched" ? "Photo will be fetched when added" : "No preview";
  return (
    <span className={cn("block overflow-hidden bg-bone", className)} data-testid={testId ? `${testId}-box` : undefined}>
      {/* A broken picture stays in the tree, hidden: what it pointed at still tells (the server fetches that address when the piece is added). */}
      {src ? <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} className={cn("size-full", imgClassName ?? "object-cover", broken && "hidden")} data-testid={testId} /> : null}
      {!src || broken ? <span className="flex size-full items-center justify-center p-1 text-center text-[11px] leading-snug text-graphite" data-testid={testId ? `${testId}-missing` : undefined}>{words}</span> : null}
    </span>
  );
}

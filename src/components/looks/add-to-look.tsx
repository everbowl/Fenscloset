"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { LookPieceInput } from "@/lib/looks/shared";
import { addToLookAction } from "@/app/(app)/looks/actions";

/**
 * "Add to a look" on a store find (Jeff, 2 Nov 2026, B1): the piece joins the open look of the person being shopped
 * for; the tray at the bottom of the page says how many are in it. Added twice, a piece is kept once.
 */
export function AddToLook({ personId, piece, className, testId = "add-to-look" }: { personId: string; piece: LookPieceInput; className?: string; testId?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "in">("idle");
  const [, start] = useTransition();
  const add = () => {
    setState("busy");
    start(async () => {
      const r = await addToLookAction(personId, piece);
      if (!r.ok) { setState("idle"); toast.error(r.error); return; }
      setState("in");
      toast.ok(r.added ? `In the look · ${r.count} ${r.count === 1 ? "piece" : "pieces"}` : "Already in the look");
      router.refresh();
    });
  };
  return (
    <button type="button" onClick={add} disabled={state !== "idle"} className={cn("pill pill-sm w-full", className)} data-testid={testId} aria-label={"title" in piece ? `Add ${piece.title} to a look` : undefined}>
      {state === "busy" ? "Adding…" : state === "in" ? "In the look ✓" : "Add to a look"}
    </button>
  );
}

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { LookPieceInput } from "@/lib/looks/shared";
import { addToLookAction } from "@/app/(app)/looks/actions";

/**
 * "Add to a look" on a store find (Jeff, 2 Nov 2026, B1): the piece joins the open look of the person being shopped
 * for. Three things say it worked (Jeff, 20 Nov 2026: "nothing happened"): the button turns into "In the look · Open",
 * a toast with "Open the look" stays for a few seconds, and the tray at the bottom counts the pieces. Added twice, a
 * piece is kept once.
 */
export function AddToLook({ personId, piece, className, testId = "add-to-look" }: { personId: string; piece: LookPieceInput; className?: string; testId?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "in">("idle");
  const [lookId, setLookId] = useState<string | null>(null);
  const [, start] = useTransition();
  const add = () => {
    setState("busy");
    start(async () => {
      const r = await addToLookAction(personId, piece);
      if (!r.ok) { setState("idle"); toast.error(r.error); return; }
      setState("in"); setLookId(r.lookId ?? null);
      const count = r.count ?? 1;
      toast.ok(r.added ? `In the look · ${count} ${count === 1 ? "piece" : "pieces"}` : "Already in the look", r.lookId ? { label: "Open the look", href: `/looks/${r.lookId}` } : undefined);
      router.refresh();
    });
  };
  if (state === "in" && lookId) {
    return <Link href={`/looks/${lookId}`} className={cn("pill pill-sm pill-solid w-full", className)} data-testid={testId} aria-label={"title" in piece ? `${piece.title} is in the look. Open the look` : "Open the look"}>In the look ✓</Link>;
  }
  return (
    <button type="button" onClick={add} disabled={state !== "idle"} className={cn("pill pill-sm w-full", className)} data-testid={testId} aria-label={"title" in piece ? `Add ${piece.title} to a look` : undefined}>
      {state === "busy" ? "Adding…" : state === "in" ? "In the look ✓" : "Add to a look"}
    </button>
  );
}

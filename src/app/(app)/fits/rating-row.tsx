"use client";

import { cn } from "@/lib/cn";
import type { FitRating } from "@/lib/fits/service";

const OPTIONS: { value: FitRating; label: string }[] = [{ value: "loved", label: "Loved it" }, { value: "fine", label: "Fine" }, { value: "never_again", label: "Never again" }];

/** "How did it go?" — three mono taps; the chosen one goes solid. Tapping it again clears it. */
export function RatingRow({ rating, disabled, onRate, compact }: { rating: FitRating | null; disabled?: boolean; onRate: (r: FitRating | null) => void; compact?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-2", !compact && "border-y border-ink py-2.5")} data-testid="rating-row">
      <span className="mono shrink-0 text-graphite">{rating ? "It went" : "How did it go?"}</span>
      <div className="flex gap-1.5">
        {OPTIONS.map((o) => (
          <button key={o.value} type="button" disabled={disabled} aria-pressed={rating === o.value} onClick={() => onRate(rating === o.value ? null : o.value)}
            className={cn("mono h-9 px-2.5 tracking-[0.1em] transition-colors", rating === o.value ? "bg-ink text-paper" : "border border-ink text-ink")} data-testid={`rate-${o.value}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

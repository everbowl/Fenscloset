"use client";

import { cn } from "@/lib/cn";
import type { FitRating } from "@/lib/fits/service";

const OPTIONS: { value: FitRating; label: string }[] = [{ value: "loved", label: "Loved it" }, { value: "fine", label: "Fine" }, { value: "never_again", label: "Never again" }];

/** "How did it go?" on its own line, then three pills; the chosen one goes solid. Tapping it again clears it. */
export function RatingRow({ rating, disabled, onRate, compact }: { rating: FitRating | null; disabled?: boolean; onRate: (r: FitRating | null) => void; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-2", !compact && "border-y border-ink py-3")} data-testid="rating-row">
      <span className="mono text-graphite" role="status">{rating ? "✓ Thanks · it went" : "How did it go?"}</span>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How did it go?">
        {OPTIONS.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={rating === o.value} disabled={disabled} onClick={() => onRate(rating === o.value ? null : o.value)}
            className={cn("pill pill-sm", rating === o.value && "pill-solid")} data-testid={`rate-${o.value}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

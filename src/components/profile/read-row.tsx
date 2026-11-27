/**
 * A row someone may read but not change: the same shape as the editable Row, with no chevron and no press state, so a
 * viewer with read access is never offered a tap that does nothing (review E G2).
 */
export function ReadRow({ label, value, muted, testId, trailing }: { label: string; value: string; muted?: boolean; testId?: string; trailing?: React.ReactNode }) {
  return (
    <div data-testid={testId} aria-disabled="true" className="flex h-12 w-full min-w-0 items-center gap-2 border-b border-line">
      <span className="mono w-[120px] shrink-0 text-graphite">{label}</span>
      <span className={`flex-1 truncate text-[15px] ${muted ? "text-graphite" : ""}`}>{value}</span>
      {trailing}
    </div>
  );
}

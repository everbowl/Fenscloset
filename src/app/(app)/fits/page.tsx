import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Fits" };

/** Month grid from the Fits mockup. Wear history fills the cells in Phase 3. */
export default function FitsPage() {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const label = now.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return (
    <div>
      <PageHeader title="Fits" aside={
        <span className="flex items-center gap-0.5 text-ink">
          <button type="button" aria-label="Previous month" className="flex size-9 items-center justify-center" disabled><ChevronLeft className="size-3" strokeWidth={2} /></button>
          {label}
          <button type="button" aria-label="Next month" className="flex size-9 items-center justify-center" disabled><ChevronRight className="size-3" strokeWidth={2} /></button>
        </span>
      } />
      <div className="mono grid grid-cols-7 border-b border-ink pb-2 text-graphite">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5 pt-1">
        {cells.map((d, i) => {
          const today = d === now.getDate();
          return (
            <div key={i} className={`relative h-12 ${today ? "border border-ink" : ""}`}>
              {d ? <span className={`mono mono-11 absolute left-1 top-1 ${today ? "bg-ink px-1 text-paper" : ""}`}>{d}</span> : null}
            </div>
          );
        })}
      </div>
      <div className="mt-[18px] border-t border-ink pt-4">
        <p className="mono text-graphite">Your fits</p>
        <p className="serif mt-1 text-[30px]">Nothing <em>yet</em></p>
        <p className="mt-2 text-[14px] leading-snug text-graphite">Every look you wear lands on this calendar from Phase 3, with a photo from the night if you want one.</p>
      </div>
    </div>
  );
}

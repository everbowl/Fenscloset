import { Block, Loading, TitleSkeleton } from "@/components/ui/skeleton";

/** The closet grid while it loads: tabs, the tools row, and the first rows of cards. */
export default function ClosetLoading() {
  return (
    <Loading>
      <TitleSkeleton />
      <div className="flex gap-[18px] overflow-hidden">{[12, 10, 16, 20, 12, 14].map((w, i) => <Block key={i} className={`h-4 w-${w}`} />)}</div>
      <div className="mt-3 flex gap-2"><Block className="h-9 w-36 rounded-full" /><Block className="h-9 w-20 rounded-full" /></div>
      <div className="mt-4 grid grid-cols-2 gap-x-2.5 gap-y-[18px] lg:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className={`flex flex-col gap-2 ${i >= 4 ? "hidden lg:flex" : ""}`}><Block className="h-[214px] lg:h-[300px]" /><Block className="h-3 w-24" /><Block className="h-2.5 w-16" /></div>)}
      </div>
    </Loading>
  );
}

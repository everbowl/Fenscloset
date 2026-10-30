import { Block, Loading, TitleSkeleton } from "@/components/ui/skeleton";

/** Fits while it loads: the month grid. */
export default function FitsLoading() {
  return (
    <Loading>
      <TitleSkeleton />
      <div className="grid grid-cols-7 gap-0.5 border-t border-ink pt-3">{Array.from({ length: 35 }, (_, i) => <Block key={i} className="h-[46px] lg:h-[84px]" />)}</div>
    </Loading>
  );
}

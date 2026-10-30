import { Block, Loading, TitleSkeleton } from "@/components/ui/skeleton";

/** Today while it loads: the context line, the title, the weather, the board. */
export default function TodayLoading() {
  return (
    <Loading>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-14">
        <div className="lg:col-start-2"><TitleSkeleton eyebrow /></div>
        <Block className="mb-4 h-[88px] lg:col-start-2" />
        <div className="flex flex-col items-center lg:col-start-1 lg:row-start-1 lg:row-span-3"><Block className="h-[210px] w-[74%]" /><Block className="-mt-10 h-[200px] w-[70%]" /><Block className="-mt-7 h-[200px] w-[62%]" /></div>
        <div className="mt-4 flex flex-col gap-2 lg:col-start-2"><Block className="h-3 w-40" /><Block className="h-5 w-full" /><Block className="h-5 w-3/4" /></div>
      </div>
    </Loading>
  );
}

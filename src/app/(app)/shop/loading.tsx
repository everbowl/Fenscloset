import { Block, Loading, TitleSkeleton } from "@/components/ui/skeleton";

/** The Shop while it loads: the title, the three ways in, the result. */
export default function ShopLoading() {
  return (
    <Loading>
      <TitleSkeleton eyebrow />
      <div className="grid grid-cols-3 gap-2"><Block className="h-[54px] rounded-full" /><Block className="h-[54px] rounded-full" /><Block className="h-[54px] rounded-full" /></div>
      <Block className="mt-2 h-[72px]" />
      <div className="mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-4"><Block className="h-[160px]" /><div className="flex flex-col gap-2 pt-1"><Block className="h-3 w-24" /><Block className="h-7 w-40" /><Block className="h-3 w-16" /></div></div>
    </Loading>
  );
}

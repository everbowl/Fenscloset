import { Block, Loading } from "@/components/ui/skeleton";

/** A piece while it loads: the photo, the title, the first rows. */
export default function ItemLoading() {
  return (
    <Loading>
      <div className="-mt-5 lg:mt-0 lg:grid lg:grid-cols-[440px_minmax(0,1fr)] lg:gap-x-12">
        <Block className="-mx-5 h-[380px] lg:mx-0 lg:h-[560px]" />
        <div>
          <div className="flex items-end justify-between pt-[18px]"><Block className="h-9 w-48" /><Block className="h-9 w-20 rounded-full" /></div>
          <Block className="mt-3 h-3 w-32" />
          <div className="mt-4 flex flex-col gap-px">{[0, 1, 2, 3, 4, 5].map((i) => <Block key={i} className="h-12" />)}</div>
        </div>
      </div>
    </Loading>
  );
}

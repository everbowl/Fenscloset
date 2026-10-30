import { Block, Loading, TitleSkeleton } from "@/components/ui/skeleton";

/** Looking-for while it loads: the title and the first lines. */
export default function LookingForLoading() {
  return (
    <Loading>
      <TitleSkeleton eyebrow />
      <Block className="h-[50px] rounded-full" />
      <div className="mt-6 flex flex-col gap-px">{[0, 1, 2].map((i) => <Block key={i} className="h-16" />)}</div>
    </Loading>
  );
}

import { Block, Loading, TitleSkeleton } from "@/components/ui/skeleton";

/** Any screen under the shell while it loads: the title block and a few rows, so a tap always answers at once. */
export default function AppLoading() {
  return (
    <Loading>
      <TitleSkeleton />
      <div className="flex flex-col gap-3"><Block className="h-12" /><Block className="h-12" /><Block className="h-12" /><Block className="h-12" /></div>
    </Loading>
  );
}

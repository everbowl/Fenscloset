import Link from "next/link";
import { openLook } from "@/lib/looks/service";

/**
 * The open look of the person being shopped for, pinned above the tab bar on every screen that can add to a look (the
 * Shop, Looking-for, a piece's go-with page, the closet): "Look · 3 pieces" and the way in. Solid black so it reads as
 * the result of "Add to a look" (Jeff, 20 Nov 2026), and nothing while the look is empty.
 */
export async function LookTray({ personId }: { personId: string }) {
  const open = await openLook(personId);
  if (!open || !open.pieces) return null;
  return (
    <Link href={`/looks/${open.id}`} className="fixed inset-x-0 bottom-[calc(76px_+_env(safe-area-inset-bottom))] z-20 bg-ink text-paper lg:bottom-0" data-testid="look-tray">
      <span className="mx-auto flex h-12 max-w-[440px] items-center justify-between gap-3 px-5 lg:max-w-[1040px] lg:px-10">
        <span className="flex min-w-0 items-baseline gap-2"><span className="mono">Look</span><span className="text-[15px]">{open.pieces} {open.pieces === 1 ? "piece" : "pieces"} so far</span></span>
        <span className="pill pill-sm shrink-0 border-paper bg-paper text-ink">Open the look →</span>
      </span>
    </Link>
  );
}

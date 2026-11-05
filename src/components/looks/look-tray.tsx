import Link from "next/link";
import { openLook } from "@/lib/looks/service";

/**
 * "Look · 3 pieces · Open →" at the bottom of every screen that can add to a look (the Shop, Looking-for, a piece's
 * go-with page, the closet): the open look of the person being shopped for, while it has something in it.
 */
export async function LookTray({ personId }: { personId: string }) {
  const open = await openLook(personId);
  if (!open || !open.pieces) return null;
  return (
    <Link href={`/looks/${open.id}`} className="fixed inset-x-0 bottom-[calc(76px_+_env(safe-area-inset-bottom))] z-20 border-t border-ink bg-paper lg:bottom-0" data-testid="look-tray">
      <span className="mono mx-auto flex h-11 max-w-[440px] items-center justify-between px-5 lg:max-w-[1040px]">
        <span className="tracking-[0.1em]">Look · {open.pieces} {open.pieces === 1 ? "piece" : "pieces"}</span>
        <span>Open <span aria-hidden>→</span></span>
      </span>
    </Link>
  );
}

import type { Metadata } from "next";
import { requirePerson } from "@/lib/auth/current";
import { listTryOns } from "@/lib/tryon";
import { mirrorConfig } from "@/lib/tryon/config";
import { MirrorScreen } from "./mirror-screen";

export const metadata: Metadata = { title: "Mirror · Fen’s Closet" };

/**
 * The mirror as its own screen (the owner, 23 Nov 2026: navigate while it dresses). The bar under the header lands here;
 * the picture being dressed, or the last one, fills the page, with the person's recent looks under it.
 */
export default async function MirrorPage() {
  const me = await requirePerson();
  const [config, recent] = await Promise.all([mirrorConfig(me), listTryOns(me.id, 12)]);
  return <MirrorScreen config={config} recent={recent} />;
}

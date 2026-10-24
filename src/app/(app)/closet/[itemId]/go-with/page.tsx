import { notFound } from "next/navigation";
import { requirePerson } from "@/lib/auth/current";
import { getItemDetail } from "@/lib/items/query";
import { latestGoWith } from "@/lib/shop/go-with";
import { GoWithScreen } from "./go-with-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "To go with it" };

/** Shop v2 item 1 (Jeff, 23 Oct 2026): what would complete this piece, products for it, and the looks the closet already makes with it. */
export default async function GoWithPage({ params, searchParams }: { params: Promise<{ itemId: string }>; searchParams: Promise<{ fresh?: string }> }) {
  const me = await requirePerson();
  const [{ itemId }, { fresh }] = await Promise.all([params, searchParams]);
  const item = await getItemDetail(itemId);
  if (!item) notFound();
  const thumb = item.photos.find((p) => p.kind === "thumb")?.bucketKey ?? null;
  const initial = fresh === "1" ? null : await latestGoWith(me, itemId);
  return <GoWithScreen itemId={item.id} name={item.name ?? "Untitled piece"} thumbKey={thumb} fresh={fresh === "1"} initial={initial} />;
}

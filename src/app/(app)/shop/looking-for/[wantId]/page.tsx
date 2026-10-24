import { notFound } from "next/navigation";
import { requirePerson } from "@/lib/auth/current";
import { openWant } from "@/lib/shop/wants";
import { WantScreen } from "./want-screen";

export const metadata = { title: "Looking for" };
export const dynamic = "force-dynamic";

/** One line on a Looking-for list: the matches (new ones marked), Buy or Judge it, Search now, Edit, Found it, Remove. Opening it counts the new ones as seen. */
export default async function WantPage({ params }: { params: Promise<{ wantId: string }> }) {
  const me = await requirePerson();
  const { wantId } = await params;
  const want = await openWant(me, wantId);
  if (!want) notFound();
  return <WantScreen meId={me.id} want={want} />;
}

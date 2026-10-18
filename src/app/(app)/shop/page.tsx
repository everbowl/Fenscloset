import { requirePerson } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { canShopFor } from "@/lib/people/visibility";
import { getLookup, listRecent } from "@/lib/shop/engine";
import { ShopScreen } from "./shop-screen";
import { tryOnState } from "@/lib/tryon";

export const metadata = { title: "Shop" };
export const dynamic = "force-dynamic";

/** Screen 15 (undrawn): "shopping for" switcher, three ways in, verdict card, pairings, picks, recent. */
export default async function ShopPage({ searchParams }: { searchParams: Promise<{ for?: string; l?: string }> }) {
  const me = await requirePerson();
  const { for: forParam, l } = await searchParams;
  const people = await db.person.findMany({ where: { status: { not: "removed" } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  const allowed: { id: string; name: string }[] = [];
  for (const p of people) if (await canShopFor(me, p.id)) allowed.push({ id: p.id, name: p.name.split(" ")[0] });
  const forPersonId = forParam && allowed.some((p) => p.id === forParam) ? forParam : me.id;
  const [recent, selected] = await Promise.all([listRecent(me, forPersonId), l ? getLookup(me, l) : Promise.resolve(null)]);
  const tryOn = await tryOnState(me, forPersonId);
  return <ShopScreen meId={me.id} people={allowed} forPersonId={forPersonId} selected={selected ?? recent[0] ?? null} recent={recent} tryOn={tryOn} />;
}

import { requirePerson } from "@/lib/auth/current";
import { getLookup, listRecent } from "@/lib/shop/engine";
import { shoppingFor } from "@/lib/shop/people";
import { newMatchCount } from "@/lib/shop/wants";
import { ShopScreen } from "./shop-screen";
import { tryOnState } from "@/lib/tryon";
import { isMannequinConfigured } from "@/lib/tryon/mannequin";
import { canDress } from "@/lib/outfits/engine";

export const metadata = { title: "Shop" };
export const dynamic = "force-dynamic";

/** Screen 15 (undrawn): "shopping for" switcher, three ways in, verdict card, pairings, picks, recent. */
export default async function ShopPage({ searchParams }: { searchParams: Promise<{ for?: string; l?: string; /** A store link to judge as soon as the page opens ("Judge it" from a piece's go-with page). */ link?: string }> }) {
  const me = await requirePerson();
  const { for: forParam, l, link } = await searchParams;
  const { people, forPersonId } = await shoppingFor(me, forParam);
  const [recent, selected, lookingFor] = await Promise.all([listRecent(me, forPersonId), l ? getLookup(me, l) : Promise.resolve(null), newMatchCount(me, forPersonId)]);
  const tryOn = await tryOnState(me, forPersonId);
  const mannequin = tryOn !== "ready" && isMannequinConfigured() && (await canDress(me, forPersonId));
  return <ShopScreen meId={me.id} people={people} forPersonId={forPersonId} selected={selected ?? recent[0] ?? null} recent={recent} tryOn={tryOn} mannequin={mannequin} autoLink={link?.trim() || null} lookingFor={lookingFor} />;
}

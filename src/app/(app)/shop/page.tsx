import { requirePerson } from "@/lib/auth/current";
import { getLookup, listRecent } from "@/lib/shop/engine";
import { shoppingFor } from "@/lib/shop/people";
import { rememberedShopFor } from "@/lib/shop/remember";
import { newMatchCount } from "@/lib/shop/wants";
import { openBrandFeed } from "@/lib/shop/brand-feed";
import { ShopScreen } from "./shop-screen";
import { LookTray } from "@/components/looks/look-tray";
import { tryOnState } from "@/lib/tryon";
import { isMannequinConfigured } from "@/lib/tryon/mannequin";
import { canDress } from "@/lib/outfits/engine";
import { sectionOf } from "@/lib/shop/section";
import { listEntries } from "@/lib/lists/service";

export const metadata = { title: "Shop" };
export const dynamic = "force-dynamic";

/** Screen 15 (undrawn): "shopping for" switcher, three ways in, verdict card, pairings, picks, recent. */
export default async function ShopPage({ searchParams }: { searchParams: Promise<{ for?: string; l?: string; /** A store link to judge as soon as the page opens ("Judge it" from a piece's go-with page). */ link?: string }> }) {
  const me = await requirePerson();
  const [{ for: forParam, l, link }, remembered] = await Promise.all([searchParams, rememberedShopFor()]);
  const { people, forPersonId } = await shoppingFor(me, forParam ?? remembered);
  // Everything the screen needs in one round (review E F1: this page was ~100 queries in a row before the first paint).
  const [recent, selected, lookingFor, brandFeed, tryOn, section, sections, dress] = await Promise.all([
    listRecent(me, forPersonId), l ? getLookup(me, l) : Promise.resolve(null), newMatchCount(me, forPersonId), openBrandFeed(me, forPersonId),
    tryOnState(me, forPersonId), sectionOf(forPersonId), listEntries("shopSection"), isMannequinConfigured() ? canDress(me, forPersonId) : Promise.resolve(false),
  ]);
  const mannequin = tryOn !== "ready" && isMannequinConfigured() && dress;
  return (
    <>
      <ShopScreen meId={me.id} people={people} forPersonId={forPersonId} section={section} sections={sections.map((x) => ({ id: x.id, name: x.name }))} isAdmin={me.role === "admin"} selected={selected ?? recent[0] ?? null} recent={recent} tryOn={tryOn} mannequin={mannequin} autoLink={link?.trim() || null} lookingFor={lookingFor} brandFeed={brandFeed ?? { personId: forPersonId, brands: [], totalBrands: 0, products: [], newCount: 0, lastFetchedAt: null, lastError: null, stale: false }} />
      <LookTray personId={forPersonId} />
    </>
  );
}

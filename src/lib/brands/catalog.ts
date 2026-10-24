/**
 * National brands offered while typing a brand (plan: brand-as-you-type). Only names and store
 * domains: picking one adds it to the family's editable Brands list (Admin → Lists → Brands), so
 * anything here can be renamed, archived or replaced in-app. A brand not listed is typed as usual.
 */
export type CatalogBrand = { name: string; domain: string };

export const BRAND_CATALOG: CatalogBrand[] = [
  { name: "7 For All Mankind", domain: "7forallmankind.com" }, { name: "A.P.C.", domain: "apc-us.com" }, { name: "Abercrombie & Fitch", domain: "abercrombie.com" },
  { name: "Adidas", domain: "adidas.com" }, { name: "Aerie", domain: "ae.com" }, { name: "Aritzia", domain: "aritzia.com" }, { name: "AG Jeans", domain: "agjeans.com" },
  { name: "Allbirds", domain: "allbirds.com" }, { name: "Alo Yoga", domain: "aloyoga.com" }, { name: "Alexander McQueen", domain: "alexandermcqueen.com" },
  { name: "American Eagle", domain: "ae.com" }, { name: "Anthropologie", domain: "anthropologie.com" }, { name: "Arc'teryx", domain: "arcteryx.com" },
  { name: "Asics", domain: "asics.com" }, { name: "Athleta", domain: "athleta.gap.com" }, { name: "Balenciaga", domain: "balenciaga.com" },
  { name: "Banana Republic", domain: "bananarepublic.gap.com" }, { name: "Bass Pro Shops", domain: "basspro.com" }, { name: "Billabong", domain: "billabong.com" },
  { name: "Birkenstock", domain: "birkenstock.com" }, { name: "Bombas", domain: "bombas.com" }, { name: "Bonobos", domain: "bonobos.com" }, { name: "Brooks", domain: "brooksrunning.com" },
  { name: "Brooks Brothers", domain: "brooksbrothers.com" }, { name: "Buck Mason", domain: "buckmason.com" }, { name: "Burberry", domain: "us.burberry.com" },
  { name: "Burton", domain: "burton.com" }, { name: "Calvin Klein", domain: "calvinklein.us" }, { name: "Canada Goose", domain: "canadagoose.com" },
  { name: "Carhartt", domain: "carhartt.com" }, { name: "Carter's", domain: "carters.com" }, { name: "Champion", domain: "champion.com" }, { name: "Chanel", domain: "chanel.com" },
  { name: "Children's Place", domain: "childrensplace.com" }, { name: "Chubbies", domain: "chubbiesshorts.com" }, { name: "Citizens of Humanity", domain: "citizensofhumanity.com" },
  { name: "Club Monaco", domain: "clubmonaco.com" }, { name: "Coach", domain: "coach.com" }, { name: "Columbia", domain: "columbia.com" }, { name: "Converse", domain: "converse.com" },
  { name: "Cotopaxi", domain: "cotopaxi.com" }, { name: "Crocs", domain: "crocs.com" }, { name: "Cuts", domain: "cutsclothing.com" }, { name: "Dickies", domain: "dickies.com" },
  { name: "Diesel", domain: "diesel.com" }, { name: "Dior", domain: "dior.com" }, { name: "Dr. Martens", domain: "drmartens.com" }, { name: "Dockers", domain: "dockers.com" },
  { name: "Eddie Bauer", domain: "eddiebauer.com" }, { name: "Everlane", domain: "everlane.com" }, { name: "Express", domain: "express.com" }, { name: "Faherty", domain: "fahertybrand.com" },
  { name: "Fendi", domain: "fendi.com" }, { name: "Fila", domain: "fila.com" }, { name: "Filson", domain: "filson.com" }, { name: "Forever 21", domain: "forever21.com" },
  { name: "Frame", domain: "frame-store.com" }, { name: "Free People", domain: "freepeople.com" }, { name: "Fruit of the Loom", domain: "fruit.com" }, { name: "Gap", domain: "gap.com" },
  { name: "Gucci", domain: "gucci.com" }, { name: "Guess", domain: "guess.com" }, { name: "Gymshark", domain: "gymshark.com" }, { name: "H&M", domain: "hm.com" },
  { name: "Hanes", domain: "hanes.com" }, { name: "Hoka", domain: "hoka.com" }, { name: "Hollister", domain: "hollisterco.com" }, { name: "Hugo Boss", domain: "hugoboss.com" },
  { name: "Hurley", domain: "hurley.com" }, { name: "J.Crew", domain: "jcrew.com" }, { name: "Jordan", domain: "nike.com" }, { name: "Kate Spade", domain: "katespade.com" },
  { name: "Kith", domain: "kith.com" }, { name: "L.L.Bean", domain: "llbean.com" }, { name: "Lacoste", domain: "lacoste.com" }, { name: "Lands' End", domain: "landsend.com" },
  { name: "Levi's", domain: "levi.com" }, { name: "Loro Piana", domain: "loropiana.com" }, { name: "Louis Vuitton", domain: "louisvuitton.com" }, { name: "Lucky Brand", domain: "luckybrand.com" },
  { name: "Lululemon", domain: "lululemon.com" }, { name: "Madewell", domain: "madewell.com" }, { name: "Marine Layer", domain: "marinelayer.com" }, { name: "Marmot", domain: "marmot.com" },
  { name: "Michael Kors", domain: "michaelkors.com" }, { name: "Mother", domain: "motherdenim.com" }, { name: "Nautica", domain: "nautica.com" }, { name: "New Balance", domain: "newbalance.com" },
  { name: "Nike", domain: "nike.com" }, { name: "Nordstrom", domain: "nordstrom.com" }, { name: "Old Navy", domain: "oldnavy.gap.com" }, { name: "On", domain: "on.com" },
  { name: "Outdoor Voices", domain: "outdoorvoices.com" }, { name: "Outerknown", domain: "outerknown.com" }, { name: "Pacsun", domain: "pacsun.com" }, { name: "Paige", domain: "paige.com" },
  { name: "Patagonia", domain: "patagonia.com" }, { name: "Prada", domain: "prada.com" }, { name: "Puma", domain: "puma.com" }, { name: "Quiksilver", domain: "quiksilver.com" },
  { name: "Rag & Bone", domain: "rag-bone.com" }, { name: "Ralph Lauren", domain: "ralphlauren.com" }, { name: "Reebok", domain: "reebok.com" }, { name: "Reformation", domain: "thereformation.com" },
  { name: "REI Co-op", domain: "rei.com" }, { name: "Rhone", domain: "rhone.com" }, { name: "Rip Curl", domain: "ripcurl.com" }, { name: "Roark", domain: "roark.com" },
  { name: "Roxy", domain: "roxy.com" }, { name: "RVCA", domain: "rvca.com" }, { name: "Saint Laurent", domain: "ysl.com" }, { name: "Salomon", domain: "salomon.com" },
  { name: "Saucony", domain: "saucony.com" }, { name: "Skechers", domain: "skechers.com" }, { name: "Skims", domain: "skims.com" }, { name: "Spanx", domain: "spanx.com" },
  { name: "Sperry", domain: "sperry.com" }, { name: "Steve Madden", domain: "stevemadden.com" }, { name: "Stüssy", domain: "stussy.com" }, { name: "Supreme", domain: "supreme.com" },
  { name: "Target (Goodfellow)", domain: "target.com" }, { name: "Target (Cat & Jack)", domain: "target.com" }, { name: "Ted Baker", domain: "tedbaker.com" }, { name: "The North Face", domain: "thenorthface.com" },
  { name: "Theory", domain: "theory.com" }, { name: "Timberland", domain: "timberland.com" }, { name: "Todd Snyder", domain: "toddsnyder.com" }, { name: "Tommy Bahama", domain: "tommybahama.com" },
  { name: "Tommy Hilfiger", domain: "usa.tommy.com" }, { name: "Tory Burch", domain: "toryburch.com" }, { name: "Travis Mathew", domain: "travismathew.com" }, { name: "True Religion", domain: "truereligion.com" },
  { name: "UGG", domain: "ugg.com" }, { name: "Under Armour", domain: "underarmour.com" }, { name: "Uniqlo", domain: "uniqlo.com" }, { name: "Urban Outfitters", domain: "urbanoutfitters.com" },
  { name: "Vans", domain: "vans.com" }, { name: "Veja", domain: "veja-store.com" }, { name: "Versace", domain: "versace.com" }, { name: "Vince", domain: "vince.com" },
  { name: "Vineyard Vines", domain: "vineyardvines.com" }, { name: "Vissla", domain: "vissla.com" }, { name: "Volcom", domain: "volcom.com" }, { name: "Vuori", domain: "vuoriclothing.com" },
  { name: "Wrangler", domain: "wrangler.com" }, { name: "Zara", domain: "zara.com" }, { name: "Zella", domain: "nordstrom.com" },
];

const fold = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9&]+/g, " ").trim();

/** Catalog brands matching what was typed: names that start with it first, then names that contain it. At most `limit`. */
export function searchCatalog(query: string, limit = 8): CatalogBrand[] {
  const q = fold(query);
  if (!q) return [];
  const starts = BRAND_CATALOG.filter((b) => fold(b.name).startsWith(q));
  const within = BRAND_CATALOG.filter((b) => !fold(b.name).startsWith(q) && fold(b.name).includes(q));
  return [...starts, ...within].slice(0, limit);
}

/** The catalog entry for a brand name already in the list, if any (gives the store domain). */
export function catalogBrand(name: string): CatalogBrand | null {
  const n = fold(name);
  return BRAND_CATALOG.find((b) => fold(b.name) === n) ?? null;
}

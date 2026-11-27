/**
 * Where am I, and where can I go: the trail for every page (Jeff, 23 Nov 2026: "Always have breadcrumb navigation to go
 * forward and back"). One map for the breadcrumb row and the header's back control, so the two never disagree.
 *
 * A trail is the tab the page lives under, then each level down to the page. The last crumb is the page itself; a
 * dynamic page (a piece, a person, a want) gets its name from the page through <CrumbLabel>, else the placeholder here.
 * `next` is the natural forward step of a flow (reviewing added pieces → the closet), shown as the trailing arrow.
 */
export type Crumb = { href: string; label: string; /** Back here lands on the closet grid: restore the remembered view. */ closet?: boolean };
export type Trail = { crumbs: Crumb[]; next?: Crumb };

export function trailFor(pathname: string, search?: URLSearchParams | null): Trail {
  const forPerson = search?.get("for");
  const withFor = (href: string) => (forPerson ? `${href}?for=${encodeURIComponent(forPerson)}` : href);
  const m = (re: RegExp) => pathname.match(re);
  const today: Crumb = { href: "/today", label: "Today" };
  const closet: Crumb = { href: "/closet", label: "Closet", closet: true };
  const shop: Crumb = { href: withFor("/shop"), label: "Shop" };
  const fits: Crumb = { href: "/fits", label: "Fits" };
  const add: Crumb = { href: "/add", label: "Add" };
  const profile: Crumb = { href: "/profile", label: "Profile" };
  const admin: Crumb = { href: "/admin/people", label: "Admin" };
  const help: Crumb = { href: "/help", label: "Help" };
  let g: RegExpMatchArray | null;

  if (pathname === "/today") return { crumbs: [today] };
  if (pathname === "/today/together") return { crumbs: [today, { href: pathname, label: "Dress us together" }] };
  if (pathname === "/closet") return { crumbs: [closet] };
  if (pathname === "/closet/clean-out") return { crumbs: [search?.get("from") === "today" ? today : closet, { href: pathname, label: "Clean out" }] };
  if ((g = m(/^\/closet\/([^/]+)\/go-with$/))) return { crumbs: [closet, { href: `/closet/${g[1]}`, label: "Piece" }, { href: pathname, label: "Goes with" }] };
  if (m(/^\/closet\/[^/]+$/)) return { crumbs: [closet, { href: pathname, label: "Piece" }] };
  if (pathname === "/add") return { crumbs: [add] };
  if (pathname === "/add/store") return { crumbs: [add, { href: pathname, label: "From a store" }] };
  if (m(/^\/add\/[^/]+$/)) return { crumbs: [add, { href: pathname, label: "Review" }], next: closet };
  if (pathname === "/shop") return { crumbs: [shop] };
  if (pathname === "/shop/looking-for") return { crumbs: [shop, { href: withFor("/shop/looking-for"), label: "Looking for" }] };
  if (m(/^\/shop\/looking-for\/.+/)) return { crumbs: [shop, { href: withFor("/shop/looking-for"), label: "Looking for" }, { href: pathname, label: "Want" }] };
  if (m(/^\/shop\/.+/)) return { crumbs: [shop, { href: pathname, label: "Shop" }] };
  if (pathname === "/fits") return { crumbs: [fits] };
  if (pathname === "/looks/new") return { crumbs: [fits, { href: pathname, label: "New look" }] };
  if (m(/^\/looks\/.+/)) return { crumbs: [fits, { href: pathname, label: "Look" }] };
  if (pathname === "/mirror") return { crumbs: [today, { href: pathname, label: "Mirror" }] };
  if (pathname === "/profile") return { crumbs: [profile] };
  if (pathname === "/profile/body") return { crumbs: [profile, { href: pathname, label: "Body" }] };
  if (pathname === "/profile/brands") return { crumbs: [profile, { href: pathname, label: "Brands & stores" }] };
  if (pathname === "/profile/style") return { crumbs: [profile, { href: pathname, label: "Style" }] };
  if (pathname === "/profile/settings") return { crumbs: [profile, { href: pathname, label: "Settings" }] };
  if (m(/^\/profile\/.+/)) return { crumbs: [profile, { href: pathname, label: "Profile" }] };
  if (pathname === "/admin/people") return { crumbs: [admin, { href: pathname, label: "People" }] };
  if (m(/^\/admin\/people\/.+/)) return { crumbs: [admin, { href: "/admin/people", label: "People" }, { href: pathname, label: "Person" }] };
  if (pathname === "/admin/lists") return { crumbs: [admin, { href: pathname, label: "Lists" }] };
  if (m(/^\/admin\/lists\/.+/)) return { crumbs: [admin, { href: "/admin/lists", label: "Lists" }, { href: pathname, label: "List" }] };
  if (pathname === "/admin/rules") return { crumbs: [admin, { href: pathname, label: "Rules" }] };
  if (m(/^\/admin(\/.*)?$/)) return { crumbs: [admin] };
  if (pathname === "/help") return { crumbs: [help] };
  if (m(/^\/help\/.+/)) return { crumbs: [help, { href: pathname, label: "Topic" }] };
  if (pathname === "/change-password") return { crumbs: [today, { href: pathname, label: "New password" }] };
  return { crumbs: [] };
}

/**
 * The crumb the header's back control goes to: one level up the trail, or null on a tab's root. Profile, Help and the
 * admin pages are reached from the person menu, so their top level climbs to Today.
 */
export function parentOf(pathname: string, search?: URLSearchParams | null): Crumb | null {
  const { crumbs } = trailFor(pathname, search);
  const today: Crumb = { href: "/today", label: "Today" };
  const adminTop = crumbs[0]?.label === "Admin" && crumbs.length <= 2;
  if (crumbs.length >= 2 && !adminTop) return crumbs[crumbs.length - 2];
  if (adminTop || pathname === "/profile" || pathname === "/help") return today;
  return null;
}

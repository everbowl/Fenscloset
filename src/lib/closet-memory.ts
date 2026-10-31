/**
 * Where the person was in the closet (tab, search, sort, filters) and how far down, so that back from a
 * piece lands on the same view at the same spot. Session storage only: it never outlives the tab.
 */
const URL_KEY = "fc:closet";
const Y_KEY = "fc:closet-y";
const RESTORE_KEY = "fc:closet-restore";

function get(key: string): string | null { try { return window.sessionStorage.getItem(key); } catch { return null; } }
function set(key: string, value: string | null) { try { if (value === null) window.sessionStorage.removeItem(key); else window.sessionStorage.setItem(key, value); } catch { /* private mode */ } }

export function rememberCloset(url: string) { set(URL_KEY, url); }
export function rememberClosetScroll(y: number) { set(Y_KEY, String(Math.round(y))); }
/** The closet URL to go back to, when there is one and it is a closet URL. */
export function lastClosetUrl(): string | null { const u = get(URL_KEY); return u && u.startsWith("/closet") ? u : null; }
/** Called when leaving for the closet: the next closet mount scrolls back to where it was. */
export function markClosetRestore() { set(RESTORE_KEY, "1"); }
/** The scroll position to restore (once), or null. */
export function takeClosetRestore(): number | null {
  if (get(RESTORE_KEY) !== "1") return null;
  set(RESTORE_KEY, null);
  const y = Number(get(Y_KEY));
  return Number.isFinite(y) ? y : null;
}

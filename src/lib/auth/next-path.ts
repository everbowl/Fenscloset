/**
 * Where a sign-in may land afterwards (security item 13, NEW-1). Only a path on this site: it must parse against a
 * placeholder origin and stay on it, carry no backslash (browsers read `/\host` as `//host`) and no control characters.
 * Anything else, including `//host`, `/\host`, `/%5Chost` and absolute links, lands on Today.
 */
const HOME = "/today";
const PLACEHOLDER = "https://placeholder.invalid";

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return HOME;
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw)) return HOME;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { return HOME; }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith("//")) return HOME;
  let u: URL;
  try { u = new URL(raw, PLACEHOLDER); } catch { return HOME; }
  if (u.origin !== PLACEHOLDER || u.username || u.password) return HOME;
  // The parser removes dot segments, so `/..//host` comes back as the path `//host`, which a browser would read as a host
  // when it lands in a redirect: the normalized path gets the same check as the raw one.
  if (!u.pathname.startsWith("/") || u.pathname.startsWith("//") || /[\\]/.test(u.pathname)) return HOME;
  return u.pathname + u.search + u.hash;
}

/**
 * A fetch for links the family pastes (store pages, product photos): the server must never be talked into calling
 * itself, the Railway network, or the cloud's metadata address (review B E1/E2, review E B1/B2).
 *
 * Every hop is checked: the typed host, then each redirect's host, each resolved with DNS first, and every address
 * must be public. Redirects are followed by hand (`redirect: "manual"`), at most `maxRedirects`. Bodies are read
 * through `readCapped` so a 300 MB page stops at the cap instead of filling memory.
 *
 * MOCK_FETCH=true (tests, the dev container) is honored by the callers, not here: this module only knows the network.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string) { super(message); this.name = "UnsafeUrlError"; }
}

/** Private, loopback, link-local, multicast and unspecified ranges, v4 and v6 (RFC 1918, 6598, 3927, 4193, 4291). */
export function isPublicAddress(addr: string): boolean {
  const kind = isIP(addr);
  if (kind === 4) {
    const [a, b] = addr.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier NAT (100.64/10)
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false; // 192.0.0/24 and 192.0.2/24 (documentation)
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  if (kind === 6) {
    const lower = addr.toLowerCase();
    if (lower === "::" || lower === "::1") return false;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return false; // unique local (fc00::/7)
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return false; // link-local
    if (lower.startsWith("ff")) return false; // multicast
    if (lower.startsWith("::ffff:")) return isPublicAddress(lower.slice(7)); // v4 mapped
    if (lower.startsWith("64:ff9b:")) return false; // NAT64 well-known prefix can hide v4 ranges
    return true;
  }
  return false;
}

/** Hostnames that are never a store, whatever they resolve to. */
function isForbiddenName(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".railway.internal") || h === "metadata.google.internal" || !h.includes(".");
}

/** Throws unless the URL is http(s) to a public host. Resolves names; literal addresses are checked as they are. */
export async function assertPublicUrl(u: URL): Promise<void> {
  if (!/^https?:$/.test(u.protocol)) throw new UnsafeUrlError("Only http and https links can be opened.");
  const host = u.hostname.replace(/^\[|\]$/g, ""); // WHATWG keeps IPv6 literals in brackets
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new UnsafeUrlError("That link isn't a store.");
    return;
  }
  if (isForbiddenName(host)) throw new UnsafeUrlError("That link isn't a store.");
  let addrs: { address: string }[];
  try { addrs = await lookup(host, { all: true }); } catch { throw new UnsafeUrlError("That address couldn't be found."); }
  if (!addrs.length || addrs.some((a) => !isPublicAddress(a.address))) throw new UnsafeUrlError("That link isn't a store.");
}

export type SafeFetchOptions = { maxRedirects?: number; timeoutMs?: number };

/**
 * fetch() with every hop checked. Returns the final response (never a 3xx unless the redirect budget is spent).
 * The final URL is on `response.url` only for the first hop in Node's undici, so it is returned alongside.
 */
export async function safeFetch(input: string | URL, init: RequestInit = {}, opts: SafeFetchOptions = {}): Promise<{ res: Response; url: URL }> {
  const maxRedirects = opts.maxRedirects ?? 5;
  let url = typeof input === "string" ? new URL(input) : input;
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, { ...init, redirect: "manual", signal: init.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 12_000) });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= maxRedirects) throw new UnsafeUrlError("That link redirects too many times.");
      await res.body?.cancel().catch(() => {});
      url = new URL(location, url);
      continue;
    }
    return { res, url };
  }
}

/** Reads at most `max` bytes of a body and stops there, so a giant answer never fills memory. */
export async function readCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) { await res.body?.cancel().catch(() => {}); throw new UnsafeUrlError("That file is too big."); }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); throw new UnsafeUrlError("That file is too big."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

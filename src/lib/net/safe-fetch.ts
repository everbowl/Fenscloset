/**
 * A fetch for links the family pastes (store pages, product photos): the server must never be talked into calling
 * itself, the Railway network, or the cloud's metadata address (review B E1/E2, review E B1/B2; security item 7).
 *
 * Every hop is checked: http or https on the default port only, the host resolved with DNS, and every address must be
 * public unicast (a maintained range table, not a hand-written list). The connection is then pinned to an address that
 * passed: the socket goes there and nowhere else, while the URL's hostname still drives TLS and the Host header, so a name
 * that answers public first and private second (DNS rebinding) cannot win. Redirects are followed by hand, at most
 * `maxRedirects`, each re-checked. One deadline covers every hop. Bodies are read through `readCapped` so a giant answer
 * stops at the cap instead of filling memory.
 *
 * MOCK_FETCH=true (tests, the dev container) is honored by the callers, not here: this module only knows the network.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";

export class UnsafeUrlError extends Error {
  constructor(message: string) { super(message); this.name = "UnsafeUrlError"; }
}

const SITE_LOCAL_V6 = ipaddr.parse("fec0::");

/**
 * Public unicast only. ipaddr.js names every special range (private, loopback, link-local, carrier NAT, multicast,
 * documentation, benchmarking, unique local, 6to4, Teredo, NAT64, discard, reserved); an IPv4-mapped IPv6 address is judged
 * by the IPv4 inside it; the deprecated site-local block is refused too. Anything that does not parse is not public.
 */
export function isPublicAddress(addr: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try { parsed = ipaddr.parse(addr.replace(/^\[|\]$/g, "")); } catch { return false; }
  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return v6.toIPv4Address().range() === "unicast";
    if (v6.match(SITE_LOCAL_V6 as ipaddr.IPv6, 10)) return false;
    return v6.range() === "unicast";
  }
  return (parsed as ipaddr.IPv4).range() === "unicast";
}

/** Hostnames that are never a store, whatever they resolve to. */
function isForbiddenName(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".railway.internal") || h === "metadata.google.internal" || !h.includes(".");
}

/** How a name becomes addresses. The system resolver in production; tests inject their own. */
export type Resolver = (host: string) => Promise<string[]>;
const systemResolver: Resolver = async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address);

function bareHost(u: URL): string {
  return u.hostname.replace(/^\[|\]$/g, ""); // WHATWG keeps IPv6 literals in brackets
}

/**
 * Throws unless the URL is http(s) on the default port to a public host, with no credentials in it. A literal address
 * is judged as it is; a name is resolved and EVERY address must be public. Returns the addresses a connection may use.
 */
export async function assertPublicUrl(u: URL, resolve: Resolver = systemResolver): Promise<string[]> {
  if (!/^https?:$/.test(u.protocol)) throw new UnsafeUrlError("Only http and https links can be opened.");
  if (u.port !== "") throw new UnsafeUrlError("That link isn't a store."); // 80 and 443 only; the parser already drops a default port
  if (u.username || u.password) throw new UnsafeUrlError("That link isn't a store.");
  const host = bareHost(u);
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new UnsafeUrlError("That link isn't a store.");
    return [host];
  }
  if (isForbiddenName(host)) throw new UnsafeUrlError("That link isn't a store.");
  let addrs: string[];
  try { addrs = await resolve(host); } catch { throw new UnsafeUrlError("That address couldn't be found."); }
  if (!addrs.length || addrs.some((a) => !isPublicAddress(a))) throw new UnsafeUrlError("That link isn't a store.");
  return addrs;
}

/**
 * The pin: the only addresses a socket may be opened to, per hostname, each set right before its request and gone a
 * minute later. The agent's lookup reads from here instead of asking DNS again, which is what closes the rebinding gap.
 */
const pinned = new Map<string, { addresses: string[]; until: number }>();
export function pinAddresses(host: string, addresses: string[]): void {
  pinned.set(host.toLowerCase(), { addresses, until: Date.now() + 60_000 });
}
/** The lookup the agent uses: a pinned address for the host, never a fresh DNS answer. Handles both callback shapes Node uses. */
export function pinnedLookup(hostname: string, options: { all?: boolean } | number, callback: (...args: unknown[]) => void): void {
  const entry = pinned.get(hostname.toLowerCase());
  if (!entry || entry.until < Date.now()) return callback(new UnsafeUrlError("No checked address for that host."));
  const address = entry.addresses[0];
  const family = isIP(address);
  if (typeof options === "object" && options?.all) return callback(null, [{ address, family }]);
  callback(null, address, family);
}

let agent: Agent | null = null;
/** The one agent every guarded request goes through: its sockets open only to pinned addresses. */
export function pinnedAgent(): Agent {
  return (agent ??= new Agent({ connect: { timeout: 8_000, lookup: pinnedLookup as never }, connections: 8 }));
}

export type SafeFetchOptions = {
  maxRedirects?: number;
  /** One deadline for every hop together. */
  timeoutMs?: number;
  /** Tests only: the resolver instead of DNS. */
  resolve?: Resolver;
  /** Tests only: sends one hop somewhere other than the real network, after the checks have passed. */
  transport?: (url: URL, init: RequestInit, addresses: string[]) => Promise<Response>;
};

/**
 * fetch() with every hop checked and pinned. Returns the final response (never a 3xx unless the redirect budget is spent)
 * and the URL it came from.
 */
export async function safeFetch(input: string | URL, init: RequestInit = {}, opts: SafeFetchOptions = {}): Promise<{ res: Response; url: URL }> {
  const maxRedirects = opts.maxRedirects ?? 5;
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 12_000);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  let url = typeof input === "string" ? new URL(input) : input;
  for (let hop = 0; ; hop++) {
    const addresses = await assertPublicUrl(url, opts.resolve);
    pinAddresses(bareHost(url), addresses);
    const hopInit = { ...init, redirect: "manual" as const, signal };
    const res = opts.transport
      ? await opts.transport(url, hopInit, addresses)
      : (await undiciFetch(url, { ...hopInit, dispatcher: pinnedAgent() } as never)) as unknown as Response;
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

import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertPublicUrl, isPublicAddress, pinAddresses, pinnedLookup, readCapped, safeFetch, UnsafeUrlError } from "@/lib/net/safe-fetch";
import { fetchImage } from "@/lib/shop/page";

const PUBLIC = "93.184.216.34"; // a public unicast address (documentation examples such as 203.0.113.x are reserved and refused)
const resolveTo = (addresses: string[]) => async () => addresses;

describe("the guarded fetch keeps the server off private networks (security item 7)", () => {
  // A server on the loopback address that counts every hit it gets: the number that must stay at zero.
  let server: Server; let port = 0; const hits: string[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url?.startsWith("/redirect-inside")) { res.writeHead(302, { location: `http://127.0.0.1:${port}/secret` }); return res.end(); }
      if (req.url?.startsWith("/redirect-public")) { res.writeHead(302, { location: "https://shop.example/landed" }); return res.end(); }
      if (req.url?.startsWith("/huge")) { res.writeHead(200, { "content-type": "text/html" }); let sent = 0; const chunk = Buffer.alloc(1 << 20, 97); const pump = () => { while (sent < 20 << 20) { sent += chunk.length; if (!res.write(chunk)) return res.once("drain", pump); } res.end(); }; return pump(); }
      res.writeHead(200, { "content-type": "text/html" }); res.end("<html><head><meta property=\"og:image\" content=\"http://127.0.0.1/inside.jpg\"></head></html>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  /** Sends a checked hop to the loopback server instead of the network, keeping the path; what the hop would have done. */
  const toLocal = async (url: URL, init: RequestInit) => fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, { ...init, redirect: "manual" });

  it("knows the private, loopback, link-local, metadata, carrier-NAT, unique-local, site-local, 6to4, Teredo and NAT64 ranges", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "10.0.0.5", "192.168.0.9", "172.16.0.1", "172.31.255.255", "169.254.169.254", "100.64.0.1", "0.0.0.0", "255.255.255.255", "224.0.0.1", "240.0.0.1",
      "::1", "::", "fd00::1", "fd12::1", "fc00::1", "fe80::1", "fec0::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.5", "2002:7f00:1::1", "2001:0:4136:e378::1", "64:ff9b::7f00:1", "100::1"]) {
      expect(isPublicAddress(a), a).toBe(false);
    }
    for (const a of ["8.8.8.8", "151.101.1.69", "172.32.0.1", PUBLIC, "2606:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(a), a).toBe(true);
    expect(isPublicAddress("not-an-address")).toBe(false);
  });

  it("refuses literal addresses in every spelling the URL parser accepts", async () => {
    for (const u of ["http://127.0.0.1/", "http://2130706433/", "http://0x7f000001/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/latest/meta-data/", "http://localhost/", "http://db.railway.internal/", "http://metadata.google.internal/"]) {
      await expect(assertPublicUrl(new URL(u)), u).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });

  it("refuses anything but http and https on the default port, and any credentials in the link", async () => {
    await expect(assertPublicUrl(new URL("ftp://shop.example/"), resolveTo([PUBLIC]))).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl(new URL("http://shop.example:8080/"), resolveTo([PUBLIC]))).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl(new URL("https://shop.example:8443/"), resolveTo([PUBLIC]))).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl(new URL("https://user:pw@shop.example/"), resolveTo([PUBLIC]))).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl(new URL("https://shop.example:443/"), resolveTo([PUBLIC]))).resolves.toEqual([PUBLIC]); // the parser drops the default port
    await expect(assertPublicUrl(new URL("http://shop.example:80/"), resolveTo([PUBLIC]))).resolves.toEqual([PUBLIC]);
  });

  it("refuses a name whose addresses include anything private, in every family, and allows a public one", async () => {
    for (const inside of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "fd12::1", "::ffff:127.0.0.1", "fec0::1"]) {
      await expect(assertPublicUrl(new URL("https://inside.example/"), resolveTo([inside])), inside).rejects.toBeInstanceOf(UnsafeUrlError);
      await expect(assertPublicUrl(new URL("https://mixed.example/"), resolveTo([PUBLIC, inside])), `public + ${inside}`).rejects.toBeInstanceOf(UnsafeUrlError); // one private answer is enough to refuse
    }
    await expect(assertPublicUrl(new URL("https://shop.example/"), resolveTo([PUBLIC]))).resolves.toEqual([PUBLIC]);
    await expect(assertPublicUrl(new URL("https://gone.example/"), async () => { throw new Error("ENOTFOUND"); })).rejects.toThrow(/couldn't be found/);
  });

  it("the connection is pinned: the agent's lookup only ever hands back an address that passed the check", () => {
    pinAddresses("shop.example", [PUBLIC]);
    const got: unknown[][] = [];
    pinnedLookup("shop.example", { all: false }, (...a) => got.push(a));
    pinnedLookup("SHOP.example", { all: true }, (...a) => got.push(a));
    pinnedLookup("never-checked.example", { all: false }, (...a) => got.push(a));
    expect(got[0]).toEqual([null, PUBLIC, 4]);
    expect(got[1]).toEqual([null, [{ address: PUBLIC, family: 4 }]]);
    expect(got[2][0]).toBeInstanceOf(UnsafeUrlError); // a host nothing checked gets no socket at all
  });

  it("a name that resolves inside never reaches the server: zero hits", async () => {
    hits.length = 0;
    await expect(safeFetch("http://inside.example/", {}, { resolve: resolveTo(["127.0.0.1"]), transport: toLocal })).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch(`http://127.0.0.1:${port}/`, {}, { transport: toLocal })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(hits).toEqual([]);
  });

  it("a public page that redirects to the loopback address is stopped at the redirect: the inside path is never hit", async () => {
    hits.length = 0;
    await expect(safeFetch("https://shop.example/redirect-inside", {}, { resolve: resolveTo([PUBLIC]), transport: toLocal })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(hits).toEqual(["/redirect-inside"]); // the public hop was made; /secret was not
    expect(hits.filter((h) => h.startsWith("/secret"))).toEqual([]);
  });

  it("a public redirect is followed with the same checks, and the final URL comes back", async () => {
    hits.length = 0;
    const { res, url } = await safeFetch("https://shop.example/redirect-public", {}, { resolve: resolveTo([PUBLIC]), transport: toLocal });
    expect(res.status).toBe(200);
    expect(url.toString()).toBe("https://shop.example/landed");
    expect(hits).toEqual(["/redirect-public", "/landed"]);
  });

  it("too many redirects stop", async () => {
    const loop = async (url: URL) => new Response(null, { status: 302, headers: { location: `https://shop.example${url.pathname}x` } });
    await expect(safeFetch("https://shop.example/a", {}, { resolve: resolveTo([PUBLIC]), transport: loop, maxRedirects: 5 })).rejects.toThrow(/redirects too many times/);
  });

  it("a page's og:image pointing inside is refused before any request, and the picture comes back as nothing", async () => {
    hits.length = 0;
    expect(await fetchImage(`http://127.0.0.1:${port}/inside.jpg`)).toBeNull();
    expect(await fetchImage("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(hits).toEqual([]);
  });

  it("a 20 MB body is cut at the cap, not read whole", async () => {
    hits.length = 0;
    const { res } = await safeFetch("https://shop.example/huge", {}, { resolve: resolveTo([PUBLIC]), transport: toLocal });
    await expect(readCapped(res, 2 << 20)).rejects.toThrow(/too big/);
    const { res: declared } = await safeFetch("https://shop.example/huge", {}, { resolve: resolveTo([PUBLIC]), transport: async () => new Response("x", { headers: { "content-length": String(30 << 20) } }) });
    await expect(readCapped(declared, 8 << 20)).rejects.toThrow(/too big/);
  });

  it("one deadline covers every hop together", async () => {
    const slow = async (url: URL, init: RequestInit) => { await new Promise((r, j) => { const t = setTimeout(r, 150); init.signal?.addEventListener("abort", () => { clearTimeout(t); j(init.signal?.reason); }); }); return new Response(null, { status: 302, headers: { location: `https://shop.example${url.pathname}x` } }); };
    await expect(safeFetch("https://shop.example/a", {}, { resolve: resolveTo([PUBLIC]), transport: slow, timeoutMs: 400, maxRedirects: 10 })).rejects.toThrow();
  });
});

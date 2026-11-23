import { readCapped, safeFetch, UnsafeUrlError } from "@/lib/net/safe-fetch";

/**
 * Reads a store page for a link lookup (plan B1): title, description, image, price, brand from
 * Open Graph / meta / JSON-LD. Fetched server-side on Railway through safeFetch, so a pasted link can never make the
 * server call itself, the Railway network or the cloud's metadata address, however it redirects (review E B1/B2).
 * MOCK_FETCH=true serves a canned page (tests, dev container).
 */
export type ProductPage = { url: string; title: string | null; description: string | null; imageUrl: string | null; priceText: string | null; brandText: string | null; siteName: string | null };

export class PageError extends Error {
  constructor(message: string, public readonly code: "bad_url" | "blocked" | "unreachable") {
    super(message);
    this.name = "PageError";
  }
}

export function normalizeUrl(input: string): URL {
  let u: URL;
  try { u = new URL(input.trim().match(/^https?:\/\//i) ? input.trim() : `https://${input.trim()}`); } catch { throw new PageError("That doesn't look like a link.", "bad_url"); }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw new PageError("That doesn't look like a link.", "bad_url");
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(u.hostname) || u.hostname.endsWith(".local")) throw new PageError("That link isn't a store.", "bad_url");
  return u;
}

const meta = (html: string, names: string[]): string | null => {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    // content="Women's Ribbed Tank" is a double-quoted value with an apostrophe inside: read to the matching quote only (review E F2).
    const m = tag?.match(/content=(?:"([^"]*)"|'([^']*)')/i);
    const content = m?.[1] ?? m?.[2];
    if (content) return decode(content.trim());
  }
  return null;
};
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");

function jsonLd(html: string): { price?: string; currency?: string; brand?: string; name?: string; image?: string } {
  const out: { price?: string; currency?: string; brand?: string; name?: string; image?: string } = {};
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        const o = node as Record<string, unknown>;
        const type = String(o["@type"] ?? "");
        if (/Product/i.test(type)) {
          if (!out.name && typeof o.name === "string") out.name = o.name;
          if (!out.brand) out.brand = typeof o.brand === "string" ? o.brand : (o.brand as { name?: string } | undefined)?.name;
          if (!out.image) out.image = typeof o.image === "string" ? o.image : Array.isArray(o.image) ? String(o.image[0]) : (o.image as { url?: string } | undefined)?.url;
        }
        if (/Offer/i.test(type) && !out.price && o.price != null) { out.price = String(o.price); out.currency = typeof o.priceCurrency === "string" ? o.priceCurrency : undefined; }
        for (const v of Object.values(o)) walk(v);
      };
      walk(JSON.parse(m[1]));
    } catch { /* ignore bad JSON-LD */ }
  }
  return out;
}

export function parseProductPage(url: string, html: string): ProductPage {
  const ld = jsonLd(html);
  const title = meta(html, ["og:title", "twitter:title"]) ?? ld.name ?? (decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim() || null);
  const amount = meta(html, ["product:price:amount", "og:price:amount", "price"]) ?? ld.price ?? null;
  const currency = meta(html, ["product:price:currency", "og:price:currency", "priceCurrency"]) ?? ld.currency ?? null;
  const priceText = amount ? (currency && currency !== "USD" ? `${amount} ${currency}` : `$${amount.replace(/^\$/, "")}`) : null;
  let imageUrl = meta(html, ["og:image", "og:image:secure_url", "twitter:image"]) ?? ld.image ?? null;
  if (imageUrl && imageUrl.startsWith("/")) { try { imageUrl = new URL(imageUrl, url).toString(); } catch { imageUrl = null; } }
  return { url, title, description: meta(html, ["og:description", "description"]), imageUrl, priceText, brandText: meta(html, ["product:brand", "og:brand", "brand"]) ?? ld.brand ?? null, siteName: meta(html, ["og:site_name"]) };
}

export const MOCK_PAGE = `<html><head><title>Linen Blazer | Mock Store</title>
<meta property="og:title" content="Linen Blazer"><meta property="og:image" content="https://mock.example/blazer.jpg">
<meta property="product:price:amount" content="128.00"><meta property="product:price:currency" content="USD"><meta property="product:brand" content="Everlane">
<meta property="og:description" content="A breezy linen blazer in oatmeal, the season's lightest."><meta property="og:site_name" content="Mock Store"></head><body></body></html>`;

const PAGE_MAX_BYTES = 2_000_000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** Fetch and parse a store page. Every hop is checked, only HTML is read, and the body stops at 2 MB. */
export async function readProductPage(input: string): Promise<ProductPage> {
  const u = normalizeUrl(input);
  if (process.env.MOCK_FETCH === "true") {
    if (process.env.MOCK_FETCH_BLOCKED === "true") throw new PageError("That store blocks link previews. Paste a screenshot instead.", "blocked");
    return parseProductPage(u.toString(), MOCK_PAGE);
  }
  let res: Response, finalUrl: URL;
  try {
    ({ res, url: finalUrl } = await safeFetch(u, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } }, { timeoutMs: 12_000 }));
  } catch (e) {
    if (e instanceof UnsafeUrlError && !/found/.test(e.message)) throw new PageError("That link isn't a store.", "bad_url"); // a private address, a bad scheme, too many redirects
    throw new PageError("That store didn't answer. Try a screenshot instead.", "unreachable");
  }
  if (res.status === 403 || res.status === 429 || res.status === 503) throw new PageError("That store blocks link previews. Paste a screenshot instead.", "blocked");
  if (!res.ok) throw new PageError("That page couldn't be opened. Check the link or paste a screenshot.", "unreachable");
  const type = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (type && !/^(text\/html|application\/xhtml\+xml)$/.test(type)) { await res.body?.cancel().catch(() => {}); throw new PageError("That link isn't a product page. Paste a screenshot instead.", "blocked"); }
  let html: string;
  try { html = (await readCapped(res, PAGE_MAX_BYTES)).toString("utf8"); }
  catch { throw new PageError("That page is too big to read. Paste a screenshot instead.", "unreachable"); }
  const page = parseProductPage(finalUrl.toString(), html);
  if (!page.title && !page.imageUrl) throw new PageError("That page doesn't look like a product. Paste a screenshot instead.", "blocked");
  return page;
}

// What a store's photo may be: anything sharp can decode into a real picture. SVG is left out (it is markup, not a photo).
const IMAGE_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif", "heif", "tiff"]);
const IMAGE_TYPE = /^(image\/(jpeg|jpg|png|webp|gif|avif|heic|heif|tiff)|application\/octet-stream|binary\/octet-stream)$/;

/**
 * Download a product image (max 8 MB) for the board and the AI read. The link is checked like a page link, the bytes
 * are sniffed with sharp rather than trusted from the header, and the picture always comes back as a JPEG. Null when
 * it can't be fetched or isn't a picture.
 */
export async function fetchImage(imageUrl: string): Promise<{ data: Buffer; contentType: string } | null> {
  if (process.env.MOCK_FETCH === "true") {
    const sharp = (await import("sharp")).default;
    return { data: await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 214, g: 196, b: 168 } } }).jpeg().toBuffer(), contentType: "image/jpeg" };
  }
  try {
    const u = normalizeUrl(imageUrl);
    const { res } = await safeFetch(u, { headers: { "user-agent": UA, accept: "image/*" } }, { timeoutMs: 12_000 });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); return null; }
    const ct = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (ct && !IMAGE_TYPE.test(ct)) { await res.body?.cancel().catch(() => {}); return null; }
    const buf = await readCapped(res, IMAGE_MAX_BYTES);
    if (!buf.length) return null;
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf).metadata();
    if (!meta.format || !IMAGE_FORMATS.has(meta.format) || !meta.width || !meta.height) return null;
    return { data: await sharp(buf, { animated: false }).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer(), contentType: "image/jpeg" };
  } catch { return null; }
}

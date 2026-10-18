/**
 * Reads a store page for a link lookup (plan B1): title, description, image, price, brand from
 * Open Graph / meta / JSON-LD. Fetched server-side on Railway. MOCK_FETCH=true serves a canned page (tests, dev container).
 */
export type ProductPage = { url: string; title: string | null; description: string | null; imageUrl: string | null; priceText: string | null; brandText: string | null };

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
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
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
  return { url, title, description: meta(html, ["og:description", "description"]), imageUrl, priceText, brandText: meta(html, ["product:brand", "og:brand", "brand"]) ?? ld.brand ?? null };
}

export const MOCK_PAGE = `<html><head><title>Linen Blazer | Mock Store</title>
<meta property="og:title" content="Linen Blazer"><meta property="og:image" content="https://mock.example/blazer.jpg">
<meta property="product:price:amount" content="128.00"><meta property="product:price:currency" content="USD"><meta property="product:brand" content="Everlane">
<meta property="og:description" content="A breezy linen blazer in oatmeal."></head><body></body></html>`;

/** Fetch and parse a store page. */
export async function readProductPage(input: string): Promise<ProductPage> {
  const u = normalizeUrl(input);
  if (process.env.MOCK_FETCH === "true") return parseProductPage(u.toString(), MOCK_PAGE);
  let res: Response;
  try {
    res = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
  } catch {
    throw new PageError("That store didn't answer. Try a screenshot instead.", "unreachable");
  }
  if (res.status === 403 || res.status === 429 || res.status === 503) throw new PageError("That store blocks link previews. Paste a screenshot instead.", "blocked");
  if (!res.ok) throw new PageError("That page couldn't be opened. Check the link or paste a screenshot.", "unreachable");
  const html = (await res.text()).slice(0, 2_000_000);
  const page = parseProductPage(res.url || u.toString(), html);
  if (!page.title && !page.imageUrl) throw new PageError("That page doesn't look like a product. Paste a screenshot instead.", "blocked");
  return page;
}

/** Download the product image (max 8 MB) for the board and the AI read. Null when it can't be fetched. */
export async function fetchImage(imageUrl: string): Promise<{ data: Buffer; contentType: string } | null> {
  if (process.env.MOCK_FETCH === "true") {
    const sharp = (await import("sharp")).default;
    return { data: await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 214, g: 196, b: 168 } } }).jpeg().toBuffer(), contentType: "image/jpeg" };
  }
  try {
    const res = await fetch(imageUrl, { headers: { "user-agent": "Mozilla/5.0", accept: "image/*" }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!/^image\/(jpeg|png|webp)$/.test(ct)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return null;
    return { data: buf, contentType: ct };
  } catch { return null; }
}

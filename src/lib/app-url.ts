/**
 * Absolute URLs for redirects. Behind Railway's proxy a request's own URL can carry the internal hostname,
 * which a browser cannot resolve, so redirects are built from APP_URL instead.
 */
export function appUrl(path: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Cookies are Secure wherever the site is served over https (production, previews). Only a plain-http APP_URL (the
 * local test server) drops the flag: WebKit refuses a Secure cookie on http://localhost where Chromium lets it through,
 * which is why the WebKit suite could not sign in (23 Nov 2026).
 */
export function cookieSecure(): boolean {
  return !(process.env.APP_URL ?? "").startsWith("http://");
}

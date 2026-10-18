/**
 * Absolute URLs for redirects. Behind Railway's proxy a request's own URL can carry the internal hostname,
 * which a browser cannot resolve, so redirects are built from APP_URL instead.
 */
export function appUrl(path: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

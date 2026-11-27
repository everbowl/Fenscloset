import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/cookies";
import { cookieSecure } from "@/lib/app-url";
import { buildCsp, CSP_HEADER, CSP_REPORT_PATH, newNonce, reportingEndpoints } from "@/lib/csp";

const PUBLIC_PREFIXES = ["/login", "/forgot-password", "/reset-password", "/invite", "/offline", "/api/health", CSP_REPORT_PATH, "/robots.txt", "/manifest.webmanifest", "/sw.js", "/icons", "/apple-touch-icon.png", "/icon.png"];

/**
 * Fast cookie-presence gate. Real validation (and the must-change-password rule) happens in the app layout. Every return
 * path, redirects included, carries the per-request Content-Security-Policy (security item 11); the nonce travels on the
 * request so Next puts it on the scripts it emits.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = newNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(CSP_HEADER, csp);
  const publicOrigin = (process.env.APP_URL ?? "").startsWith("https://") ? new URL(process.env.APP_URL!).origin : request.nextUrl.origin;
  const withCsp = <R extends NextResponse>(res: R): R => { res.headers.set(CSP_HEADER, csp); res.headers.set("Reporting-Endpoints", reportingEndpoints(publicOrigin)); return res; };

  // Over plain http the Secure session cookie is dropped by the phone, so a sign-in looks like it did nothing (review A
  // A4). When the site lives on https, send every page there first. Health checks reach the container directly, so
  // /api is left alone.
  const appUrl = process.env.APP_URL ?? "";
  if (appUrl.startsWith("https://") && request.headers.get("x-forwarded-proto") === "http" && !pathname.startsWith("/api/")) {
    return withCsp(NextResponse.redirect(new URL(pathname + request.nextUrl.search, appUrl), 308));
  }

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    // A fetch from the page wants a status it can read, not the sign-in page as HTML (review A S10).
    if (pathname.startsWith("/api/")) return withCsp(NextResponse.json({ error: "Signed out. Sign in again." }, { status: 401 }));
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" && pathname !== "/today" ? `?next=${encodeURIComponent(pathname)}` : "";
    return withCsp(NextResponse.redirect(url));
  }

  const res = withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
  // The session slides in the database while the person keeps coming back; the cookie has to slide with it or the phone
  // forgets it on day 30 (review A W3). Re-set on page loads only, not on every image or data request.
  const pageLoad = request.method === "GET" && !pathname.startsWith("/api/") && !request.headers.get("rsc") && !request.headers.get("next-router-prefetch");
  if (pageLoad) {
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: cookieSecure(), path: "/", expires: new Date(Date.now() + SESSION_TTL_MS) });
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webp|jpg)$).*)"],
};

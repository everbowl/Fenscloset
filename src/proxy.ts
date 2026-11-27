import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/cookies";
import { cookieSecure } from "@/lib/app-url";

const PUBLIC_PREFIXES = ["/login", "/forgot-password", "/reset-password", "/invite", "/offline", "/api/health", "/robots.txt", "/manifest.webmanifest", "/sw.js", "/icons", "/apple-touch-icon.png", "/icon.png"];

/** Fast cookie-presence gate. Real validation (and the must-change-password rule) happens in the app layout. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Over plain http the Secure session cookie is dropped by the phone, so a sign-in looks like it did nothing (review A
  // A4). When the site lives on https, send every page there first. Health checks reach the container directly, so
  // /api is left alone.
  const appUrl = process.env.APP_URL ?? "";
  if (appUrl.startsWith("https://") && request.headers.get("x-forwarded-proto") === "http" && !pathname.startsWith("/api/")) {
    const target = new URL(appUrl);
    target.pathname = pathname; // set, never parsed: a `//host` path must stay a path (security item 13)
    target.search = request.nextUrl.search;
    return NextResponse.redirect(target, 308);
  }

  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    // A fetch from the page wants a status it can read, not the sign-in page as HTML (review A S10).
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Signed out. Sign in again." }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" && pathname !== "/today" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
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

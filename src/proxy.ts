import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

const PUBLIC_PREFIXES = ["/login", "/forgot-password", "/reset-password", "/invite", "/offline", "/api/health", "/manifest.webmanifest", "/sw.js", "/icons", "/apple-touch-icon.png", "/icon.png"];

/** Fast cookie-presence gate. Real validation (and the must-change-password rule) happens in the app layout. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" && pathname !== "/today" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webp|jpg)$).*)"],
};

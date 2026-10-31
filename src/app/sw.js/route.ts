import { SW_SOURCE } from "@/lib/sw-source";

/**
 * The service worker, served with a version per deploy so the cached offline page and assets refresh
 * on every build (a fixed string never did). Railway gives the commit; a dev build uses the start time.
 */
const VERSION = (process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.SOURCE_VERSION ?? String(Date.now())).slice(0, 12);
const source = SW_SOURCE.replace('const VERSION = "v1";', `const VERSION = "${VERSION}";`);

export function GET() {
  return new Response(source, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" } });
}

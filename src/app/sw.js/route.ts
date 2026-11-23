import { swScript, swVersion } from "@/lib/sw-source";

/** Served fresh on every request (the handler takes no request, so Next would otherwise prerender it and may swap the cache header). */
export const dynamic = "force-dynamic";

/**
 * The service worker, versioned per build so the browser installs a new one on every deploy (a fixed string never did).
 * RAILWAY_GIT_COMMIT_SHA is the commit; NEXT_PUBLIC_BUILD is fixed once at build time by next.config.ts and inlined here.
 * Both are named in full so the build can inline them.
 */
const source = swScript(swVersion({ sha: process.env.RAILWAY_GIT_COMMIT_SHA, build: process.env.NEXT_PUBLIC_BUILD }));

export function GET() {
  return new Response(source, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" } });
}

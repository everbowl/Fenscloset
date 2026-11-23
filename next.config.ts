import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { PHASE_PRODUCTION_SERVER } from "next/constants";

/**
 * One id per build, fixed here once and inlined into the bundles, so every replica and every restart of one build agree
 * (the service worker's version, src/app/sw.js/route.ts): Railway's commit, else the git commit, else the moment of the build.
 */
function buildId(): string {
  const given = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD;
  if (given) return given.slice(0, 12);
  try { return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return String(Date.now()); }
}

/* A private family app, still: never framed, no referrer past the origin, the camera only for ourselves. Only frame-ancestors in the CSP, so the inline <style> that carries the accent keeps working. */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self)" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // argon2 and pg are native/node-only; keep them out of the bundler.
  serverExternalPackages: ["argon2", "pg", "@prisma/adapter-pg", "sharp"],
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BUILD: buildId() },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default function config(phase: string): NextConfig {
  // APP_URL unset in production sends every reset and invite link to localhost. Say so where the logs are read, loudly, and keep serving.
  if (phase === PHASE_PRODUCTION_SERVER && !process.env.APP_URL) {
    console.error("[config] APP_URL is not set: password-reset and invite links will point at http://localhost:3000. Set APP_URL to the public address.");
  }
  return nextConfig;
}

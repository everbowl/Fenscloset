import type { NextConfig } from "next";

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
};

export default nextConfig;

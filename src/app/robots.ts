import type { MetadataRoute } from "next";

/** A private family closet: no search engine indexes it (the owner, 26 Nov 2026, 5A). Googlebot had been crawling the login page. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}

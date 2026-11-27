import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/next-path";

describe("where a sign-in may land (security item 13)", () => {
  it("every off-site form lands on Today", () => {
    for (const bad of ["/\\evil.test", "/\\\\evil.test", "//evil.test", "/%5Cevil.test", "/%5c%5cevil.test", "https://evil.test", "http://evil.test/closet", "javascript:alert(1)", "evil.test", "/\\evil.test/closet", "/%2F%2Fevil.test", "/closet\u0000", "/\r\nLocation: https://evil.test", "", null, undefined, "/..//evil.test", "//evil.test/%2F.."]) {
      expect(safeNextPath(bad), String(bad)).toBe("/today");
    }
  });
  it("a real path on this site is kept, with its query and hash", () => {
    expect(safeNextPath("/closet/123")).toBe("/closet/123");
    expect(safeNextPath("/shop?q=linen%20blazer#top")).toBe("/shop?q=linen%20blazer#top");
    expect(safeNextPath("/today")).toBe("/today");
  });
});

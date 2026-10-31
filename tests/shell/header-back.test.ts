import { describe, expect, it } from "vitest";
import { parentOf } from "@/components/header-back";
import { prettyDate } from "@/lib/dates";

const sp = (s: string) => new URLSearchParams(s);

describe("the header's back control", () => {
  it("goes to the parent of every page that has one, never off the site", () => {
    expect(parentOf("/closet/abc")).toEqual({ href: "/closet", label: "Closet", closet: true });
    expect(parentOf("/closet/abc/go-with")).toEqual({ href: "/closet/abc", label: "the piece" });
    expect(parentOf("/profile/body")?.href).toBe("/profile");
    expect(parentOf("/profile")?.href).toBe("/today");
    expect(parentOf("/today/together")?.href).toBe("/today");
    expect(parentOf("/add/store")?.href).toBe("/add");
    expect(parentOf("/admin/lists/color")?.href).toBe("/admin/lists");
    expect(parentOf("/admin/people/p1")?.href).toBe("/admin/people");
    expect(parentOf("/admin/rules")?.href).toBe("/today");
    expect(parentOf("/help/add")?.href).toBe("/help");
    expect(parentOf("/today")).toBeNull();
    expect(parentOf("/closet")).toBeNull();
  });
  it("keeps who the Shop is for on the way back, and climbs Looking-for one level at a time", () => {
    expect(parentOf("/shop/looking-for/w1", sp("for=kid"))?.href).toBe("/shop/looking-for?for=kid");
    expect(parentOf("/shop/looking-for", sp("for=kid"))?.href).toBe("/shop?for=kid");
    expect(parentOf("/shop/looking-for/w1")?.href).toBe("/shop/looking-for");
    expect(parentOf("/shop/other")?.href).toBe("/shop");
  });
  it("sends Clean-out back where it came from", () => {
    expect(parentOf("/closet/clean-out", sp("from=today"))?.href).toBe("/today");
    expect(parentOf("/closet/clean-out")).toEqual({ href: "/closet", label: "Closet", closet: true });
  });
});

describe("dates in sentences", () => {
  it("reads as an American date", () => {
    expect(prettyDate("2026-10-18")).toBe("Oct 18, 2026");
  });
});

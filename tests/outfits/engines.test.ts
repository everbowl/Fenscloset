import { describe, expect, it } from "vitest";
import { COMPARE_DEFAULTS, resolveEngines } from "@/lib/tryon/engines";

const all = { google: true, fashn: true, kling: true };

describe("which engines Compare runs", () => {
  it("runs every keyed engine when no switch is given", () => {
    expect(resolveEngines("compare", all).engines).toEqual(["google", "fashn", "kling"]);
  });
  it("leaves a switched-off engine out without a note (owner, 26 Nov 2026, 1B: Kling off until its balance is topped up)", () => {
    const r = resolveEngines("compare", all, COMPARE_DEFAULTS);
    expect(r.engines).toEqual(["google", "fashn"]);
    expect(r.note).toBeUndefined();
  });
  it("still names an engine that is switched on but has no key", () => {
    const r = resolveEngines("compare", { google: true, fashn: false, kling: true }, COMPARE_DEFAULTS);
    expect(r.engines).toEqual(["google"]);
    expect(r.note).toContain("FASHN");
    expect(r.note).not.toContain("Kling");
  });
  it("with every switch off, one keyed engine still dresses", () => {
    const r = resolveEngines("compare", all, { google: false, fashn: false, kling: false });
    expect(r.engines).toEqual(["google"]);
  });
  it("a single chosen engine ignores the Compare switches", () => {
    expect(resolveEngines("kling", all, COMPARE_DEFAULTS).engines).toEqual(["kling"]);
  });
});

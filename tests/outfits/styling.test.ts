import { describe, expect, it } from "vitest";
import { featuresOf, resolveStyling, stylingPrompt, stylingSentence, type StylingLists } from "@/lib/tryon/features";

const lists: StylingLists = {
  poses: [{ id: "p-stand", name: "Standing, as photographed", prompt: "" }, { id: "p-pockets", name: "Hands in pockets", prompt: "both hands in the front pockets" }],
  groups: [
    { id: "g-tuck", name: "Tuck", needs: ["top", "bottom"], options: [{ id: "o-untucked", name: "Untucked", prompt: "the top worn untucked" }, { id: "o-tucked", name: "Tucked", prompt: "the top tucked in" }] },
    { id: "g-buttons", name: "Buttons", needs: ["button_front"], options: [{ id: "o-one", name: "Top one open", prompt: "the top button undone" }, { id: "o-all", name: "All buttoned", prompt: "buttoned to the collar" }] },
    { id: "g-sleeves", name: "Sleeves", needs: ["long_sleeve"], options: [{ id: "o-down", name: "Down", prompt: "" }, { id: "o-rolled", name: "Rolled", prompt: "sleeves rolled to the elbow" }] },
    { id: "g-empty", name: "Empty group", needs: [], options: [] },
  ],
};

describe("mirror styling (pure)", () => {
  it("features: stored ones win, else a guess from the type; the category adds top / bottom / outer", () => {
    expect([...featuresOf({ features: ["hood"], category: "Tops", subcategory: "Button-down" })].sort()).toEqual(["hood", "top"]);
    expect([...featuresOf({ features: [], category: "Tops", subcategory: "Button-down" })].sort()).toEqual(["button_front", "collar", "top"]);
    expect([...featuresOf({ category: "Tops", subcategory: "Hoodie" })].sort()).toEqual(["hood", "long_sleeve", "top"]);
    expect([...featuresOf({ category: "Bottoms", subcategory: "Jeans" })]).toEqual(["bottom"]);
    expect([...featuresOf({ category: "Outerwear", subcategory: "Puffer" })].sort()).toEqual(["long_sleeve", "outer", "top", "zip_front"]);
    expect([...featuresOf({ features: ["nonsense"], category: "Shoes" })]).toEqual([]);
  });

  it("defaults to the first entry of each list; only groups the look has the features for; blank prompts give no instruction", () => {
    const tee = resolveStyling(lists, {}, undefined, ["top", "bottom"]);
    expect(tee.groups.map((g) => g.name)).toEqual(["Tuck"]);
    expect(tee.options).toEqual({ "g-tuck": "o-untucked" });
    expect(tee.poseId).toBe("p-stand");
    expect(tee.instructions).toEqual(["the top worn untucked"]);
    expect(tee.summary).toBe("Untucked"); // the pose has nothing to say, so it is not in the caption
    expect(tee.key).toBe("pose=p-stand;g-tuck=o-untucked");
    const shirt = resolveStyling(lists, {}, undefined, ["top", "bottom", "button_front", "long_sleeve"]);
    expect(shirt.groups.map((g) => g.name)).toEqual(["Tuck", "Buttons", "Sleeves"]);
    expect(shirt.instructions).toEqual(["the top worn untucked", "the top button undone"]); // Sleeves "Down" is blank
    expect(shirt.summary).toBe("Untucked · Top one open · Down");
    const dress = resolveStyling(lists, {}, undefined, ["top"]);
    expect(dress.groups).toEqual([]);
    expect(dress.instructions).toEqual([]);
    expect(dress.key).toBe("pose=p-stand");
  });

  it("a pick wins over what is remembered, which wins over the default; unknown ids fall back", () => {
    const remembered = { poseId: "p-pockets", options: { "g-tuck": "o-tucked", "g-buttons": "o-all" } };
    const r = resolveStyling(lists, remembered, undefined, ["top", "bottom", "button_front"]);
    expect(r.options).toEqual({ "g-tuck": "o-tucked", "g-buttons": "o-all" });
    expect(r.instructions).toEqual(["the top tucked in", "buttoned to the collar", "both hands in the front pockets"]);
    expect(r.summary).toBe("Tucked · All buttoned · Hands in pockets");
    const picked = resolveStyling(lists, remembered, { options: { "g-tuck": "o-untucked" } }, ["top", "bottom", "button_front"]);
    expect(picked.options).toEqual({ "g-tuck": "o-untucked", "g-buttons": "o-all" });
    expect(picked.poseId).toBe("p-pockets");
    const stale = resolveStyling(lists, { poseId: "gone", options: { "g-tuck": "gone" } }, { poseId: null }, ["top", "bottom"]);
    expect(stale.poseId).toBe("p-stand");
    expect(stale.options).toEqual({ "g-tuck": "o-untucked" });
  });

  it("the key is canonical regardless of group order", () => {
    const a = resolveStyling(lists, { options: { "g-sleeves": "o-rolled", "g-buttons": "o-all" } }, undefined, ["button_front", "long_sleeve"]);
    const b = resolveStyling({ ...lists, groups: [...lists.groups].reverse() }, { options: { "g-buttons": "o-all", "g-sleeves": "o-rolled" } }, undefined, ["long_sleeve", "button_front"]);
    expect(a.key).toBe(b.key);
    expect(a.key).toBe("pose=p-stand;g-buttons=o-all;g-sleeves=o-rolled");
  });

  it("the artist's brief lists only the changes and tells it to keep the person and the clothes", () => {
    const brief = stylingPrompt(["the top worn untucked", "both hands in the front pockets"]);
    expect(brief).toContain("Make only these changes: the top worn untucked; both hands in the front pockets.");
    expect(brief).toMatch(/same person, face/);
    expect(brief).toMatch(/exact color, fade, print/);
    expect(stylingSentence([])).toBe("");
    expect(stylingSentence(["x"])).toBe(" Wear and pose them like this: x.");
  });
});

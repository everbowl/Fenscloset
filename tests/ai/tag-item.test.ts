import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { loadTagLists, mapTags, tagItem, tagSchema, type RawTags } from "@/lib/ai/tag-item";

describe("tagging constrained to the lists", () => {
  beforeEach(async () => { await resetDb(); process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; await seed(); });

  it("builds enums from the editable lists", async () => {
    const lists = await loadTagLists();
    const schema = tagSchema(lists) as { properties: Record<string, { enum?: unknown[]; items?: { enum: string[] }; anyOf?: { type: string; enum?: string[] }[] }> };
    expect(schema.properties.category.enum).toContain("Tops");
    expect(schema.properties.category.enum).toContain("unknown");
    expect(schema.properties.colors.items!.enum).toContain("Black");
    // nullable enums are anyOf [string enum, null]: structured outputs reject enum with a type list
    expect(schema.properties.subcategory.anyOf!.map((a) => a.type)).toEqual(["string", "null"]);
    expect(schema.properties.subcategory.anyOf![0].enum).toContain("Jeans");
  });

  it("maps names the model returns onto ids, and anything outside the lists to null", async () => {
    const lists = await loadTagLists();
    const raw: RawTags = {
      name: "  Chartreuse blazer ", category: "Outerwear", subcategory: "Not a real sub", colors: ["Chartreuse", "black", "Black"],
      pattern: "unknown", fabric: "Kevlar", fabricConfidence: 0.2, seasons: ["Fall", "Monsoon"], formality: "Business",
      brandText: "nike", sizeText: " M ", confidence: 1.7,
    };
    const t = mapTags(raw, lists);
    expect(t.name).toBe("Chartreuse blazer");
    expect(t.categoryId).toBe(lists.categories.find((c) => c.name === "Outerwear")!.id);
    expect(t.subcategoryId).toBeNull();
    expect(t.colorIds).toEqual([lists.colors.find((c) => c.name === "Black")!.id]);
    expect(t.patternId).toBeNull();
    expect(t.fabricId).toBeNull();
    expect(t.seasonIds).toEqual([lists.seasons.find((s) => s.name === "Fall")!.id]);
    expect(t.formalityId).toBe(lists.formalities.find((f) => f.name === "Business")!.id);
    expect(t.brandId).toBe(lists.brands.find((b) => b.name === "Nike")!.id);
    expect(t.brandText).toBe("nike");
    expect(t.sizeText).toBe("M");
    expect(t.confidence).toBe(1);
  });

  it("never crashes on a category or subcategory that is not in the lists", async () => {
    const lists = await loadTagLists();
    const t = mapTags({ name: "", category: "Spacesuit", subcategory: "Helmet", colors: [], pattern: "x", fabric: "y", fabricConfidence: NaN, seasons: [], formality: "z", brandText: null, sizeText: null, confidence: NaN }, lists);
    expect(t).toMatchObject({ name: "Untitled piece", categoryId: null, subcategoryId: null, colorIds: [], fabricConfidence: 0, confidence: 0 });
  });

  it("mock tagging returns ids from the seeded lists", async () => {
    const lists = await loadTagLists();
    const t = await tagItem({ image: { data: "", mediaType: "image/jpeg" }, lists });
    expect(t.categoryId).toBe(lists.categories.find((c) => c.name === "Tops")!.id);
    expect(t.colorIds).toHaveLength(1);
    expect(t.confidence).toBeGreaterThan(0.5);
  });
});

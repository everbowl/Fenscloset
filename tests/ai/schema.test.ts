import { describe, expect, it } from "vitest";
import { apiSchema } from "@/lib/ai/claude";
import { tagSchema, type TagLists } from "@/lib/ai/tag-item";
import { ownedRowsSchema } from "@/lib/store/words";

/** Every key at every depth of a schema, so a bound hidden three levels down is still found. */
function keysDeep(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => keysDeep(n, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) { out.push(k); keysDeep(v, out); }
  return out;
}
const REJECTED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"];

describe("schemas sent to the structured-output endpoint", () => {
  it("strips the numeric keywords the API rejects, at every depth, and keeps everything else", () => {
    const schema = {
      type: "object", required: ["n", "rows"],
      properties: {
        n: { type: "integer", minimum: 1, maximum: 9, description: "1 to 9" },
        rows: { type: "array", items: { type: "object", properties: { q: { type: "number", exclusiveMinimum: 0, multipleOf: 0.5 } } } },
        pick: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        minimum: { type: "string", description: "a property that happens to be named minimum stays" },
      },
    };
    const out = apiSchema(schema) as typeof schema;
    expect(keysDeep(out).filter((k) => REJECTED.includes(k))).toEqual(["minimum"]); // only the property named minimum
    expect(out.properties.n).toEqual({ type: "integer", description: "1 to 9" });
    expect(out.properties.rows.items.properties.q).toEqual({ type: "number" });
    expect(out.properties.pick.anyOf[0]).toEqual({ type: "integer" });
    expect(out.properties.minimum.description).toContain("stays");
    expect(schema.properties.n.minimum).toBe(1); // the caller's schema is left alone
  });

  it("the tagging and owned-rows schemas carry no numeric bound (the live failure of 26 Nov)", () => {
    const lists: TagLists = {
      categories: [{ id: "c1", name: "Tops", subcategories: [{ id: "s1", name: "Tees" }] }],
      colors: [{ id: "k1", name: "Black" }], patterns: [], fabrics: [], seasons: [{ id: "n1", name: "Fall" }], formalities: [], brands: [],
    };
    for (const schema of [tagSchema(lists), ownedRowsSchema()]) {
      expect(keysDeep(schema).filter((k) => REJECTED.includes(k))).toEqual([]);
    }
  });
});

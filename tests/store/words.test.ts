import { describe, expect, it } from "vitest";
import { mockOwnedRows, ownedRowsFromWords } from "@/lib/store/words";

const page = { name: "Crew Tee", colors: ["Black", "Navy", "White", "Heather Grey"], sizes: ["S", "M", "L", "XL"] };

describe("tell it in words (bulk add from a product card)", () => {
  it("reads a total, one size for all, and colors with counts in the page's spelling", () => {
    expect(mockOwnedRows("I own 7 of these shirts. All Medium. These are the colors: black ×2, navy, white, grey x3", page)).toEqual([
      { color: "Black", size: "M", quantity: 2 },
      { color: "Navy", size: "M", quantity: 1 },
      { color: "White", size: "M", quantity: 1 },
      { color: "Heather Grey", size: "M", quantity: 3 },
    ]);
  });

  it("takes counts before the color, a size in letters, and colors the page does not list", () => {
    expect(mockOwnedRows("all L: 2 black, 1 olive", page)).toEqual([
      { color: "Black", size: "L", quantity: 2 },
      { color: "olive", size: "L", quantity: 1 },
    ]);
  });

  it("with no colors named, one row for the total; nothing from an empty note", () => {
    expect(mockOwnedRows("I have 4 of these, size XL", page)).toEqual([{ color: null, size: "XL", quantity: 4 }]);
    expect(mockOwnedRows("", page)).toEqual([]);
    expect(mockOwnedRows("   ", page)).toEqual([]);
  });

  it("caps a count at ten and uses the mock reader when AI is off", async () => {
    process.env.MOCK_AI = "true";
    expect(mockOwnedRows("black ×40", page)[0]).toMatchObject({ quantity: 10 });
    expect(await ownedRowsFromWords("navy (2)", page)).toEqual([{ color: "Navy", size: null, quantity: 2 }]);
  });
});

import { describe, expect, it } from "vitest";
import { candidatesFor, missingSlots, shoesPlaceable, slotOf, SLOT_WORD, swapIn, type MirrorPiece, type Wardrobe } from "@/lib/tryon/complete";

const piece = (id: string, category: string | null, isFavorite = false): MirrorPiece => ({ id, name: id, thumbKey: null, category, isFavorite });
const tee = piece("tee", "Tops"), tee2 = piece("tee2", "Tops", true), jeans = piece("jeans", "Bottoms"), chinos = piece("chinos", "Bottoms", true), dress = piece("dress", "Dresses"), sneakers = piece("sneakers", "Shoes"), boots = piece("boots", "Shoes", true), blazer = piece("blazer", "Outerwear"), hat = piece("hat", "Hats"), untyped = piece("mystery", null);
const wardrobe: Wardrobe = { pieces: [tee, tee2, jeans, chinos, dress, sneakers, boots, blazer, hat], goesWith: { tee: ["chinos", "sneakers"], chinos: ["tee"] } };

describe("completing a look before the mirror", () => {
  it("knows which slot a piece fills and when shoes can be placed", () => {
    expect(slotOf("Tops")).toBe("top"); expect(slotOf("Outerwear")).toBe("top"); expect(slotOf("Bottoms")).toBe("bottom");
    expect(slotOf("Dresses")).toBe("onePiece"); expect(slotOf("Shoes")).toBe("shoes"); expect(slotOf("Hats")).toBeNull(); expect(slotOf(null)).toBeNull();
    expect(shoesPlaceable("me", "fashn")).toBe(false); expect(shoesPlaceable("me", "google")).toBe(true); expect(shoesPlaceable("mannequin", "fashn")).toBe(true);
  });

  it("asks for what is missing, in order, only when the closet has it; a one-piece asks for no top or bottom; an untyped piece asks nothing", () => {
    const can = { shoesPlaceable: true }, cannot = { shoesPlaceable: false };
    expect(missingSlots([tee], wardrobe, can)).toEqual(["bottom", "shoes"]);
    expect(missingSlots([tee], wardrobe, cannot)).toEqual(["bottom"]); // FASHN on your own photo: shoes stay off, so no question
    expect(missingSlots([jeans], wardrobe, can)).toEqual(["top", "shoes"]);
    expect(missingSlots([blazer], wardrobe, can)).toEqual(["bottom", "shoes"]);
    expect(missingSlots([dress], wardrobe, can)).toEqual(["shoes"]);
    expect(missingSlots([dress], wardrobe, cannot)).toEqual([]);
    expect(missingSlots([tee, jeans], wardrobe, can)).toEqual(["shoes"]);
    expect(missingSlots([tee, jeans, sneakers], wardrobe, can)).toEqual([]);
    expect(missingSlots([untyped], wardrobe, can)).toEqual([]);
    // a closet with no bottoms and no shoes: a top asks for nothing
    expect(missingSlots([tee], { pieces: [tee, tee2], goesWith: {} }, can)).toEqual([]);
  });

  it("offers the slot's pieces with the Shop's suggestions first, then favorites, never what is already in the look", () => {
    expect(candidatesFor("bottom", wardrobe, ["tee"]).map((p) => [p.id, p.suggested])).toEqual([["chinos", true], ["jeans", false]]);
    expect(candidatesFor("top", wardrobe, ["chinos"]).map((p) => p.id)).toEqual(["tee", "tee2", "blazer"]); // tee suggested beats tee2 favorite
    expect(candidatesFor("shoes", wardrobe, ["jeans"]).map((p) => p.id)).toEqual(["boots", "sneakers"]); // favorite first when nothing is suggested
    expect(candidatesFor("top", wardrobe, ["tee", "jeans"]).map((p) => p.id)).toEqual(["tee2", "blazer"]);
  });

  it("a tapped piece takes its slot's place: a top for a top, shoes for shoes, a dress for a top and bottom, a top for a dress", () => {
    expect(swapIn(["tee", "jeans", "sneakers"], tee2, wardrobe)).toEqual(["jeans", "sneakers", "tee2"]);
    expect(swapIn(["tee", "jeans", "sneakers"], boots, wardrobe)).toEqual(["tee", "jeans", "boots"]);
    expect(swapIn(["tee", "jeans"], sneakers, wardrobe)).toEqual(["tee", "jeans", "sneakers"]);
    expect(swapIn(["tee", "jeans", "sneakers"], dress, wardrobe)).toEqual(["sneakers", "dress"]);
    expect(swapIn(["dress", "sneakers"], tee, wardrobe)).toEqual(["sneakers", "tee"]);
    expect(swapIn(["tee", "jeans"], tee, wardrobe)).toEqual(["jeans", "tee"]); // the same piece again: still one of it
  });

  it("says the question and the way out in the person's words", () => {
    expect(SLOT_WORD.bottom.ask).toBe("Add a bottom?");
    expect(SLOT_WORD.bottom.skip([tee])).toBe("Just the top");
    expect(SLOT_WORD.top.skip([jeans])).toBe("Just the bottom");
    expect(SLOT_WORD.top.skip([sneakers])).toBe("No top");
    expect(SLOT_WORD.shoes.skip([tee, jeans])).toBe("No shoes");
  });
});

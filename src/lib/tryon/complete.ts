import type { Engine } from "@/lib/tryon/engines";

/**
 * Completing a look before the mirror dresses it (Jeff, 24 Oct 2026: "make me select a top and bottom if it's not a
 * full one piece; a pant or short should then ask me for a top; if I have shoes it should ask; I can decline").
 * Client-safe: the pure rules for which slot is missing, which closet pieces fit it, and how a tap swaps a piece in.
 */

export type MirrorPiece = { id: string; name: string; thumbKey: string | null; category: string | null; isFavorite: boolean };
/** The pieces the mirror can place, favorites first, and what the Shop already suggested goes with what (go-with looks). */
export type Wardrobe = { pieces: MirrorPiece[]; goesWith: Record<string, string[]> };
export type Slot = "top" | "bottom" | "shoes";

const TOP = new Set(["Tops", "Outerwear"]);
const BOTTOM = new Set(["Bottoms"]);
const ONE_PIECE = new Set(["Dresses"]);

export const EMPTY_WARDROBE: Wardrobe = { pieces: [], goesWith: {} };

/** Which part of a look a piece fills. */
export function slotOf(category: string | null | undefined): Slot | "onePiece" | null {
  if (!category) return null;
  if (TOP.has(category)) return "top";
  if (BOTTOM.has(category)) return "bottom";
  if (ONE_PIECE.has(category)) return "onePiece";
  if (category === "Shoes") return "shoes";
  return null;
}

/** FASHN places tops, bottoms and one-pieces, not shoes; Google and the mannequin's image model can. */
export function shoesPlaceable(on: "me" | "mannequin", engine: Engine): boolean {
  return on === "mannequin" || engine !== "fashn";
}

/**
 * What the mirror should ask for, in order: a top or a bottom when the look has neither a one-piece nor that slot,
 * then shoes when the closet has some and the picture can show them. An untyped piece asks for nothing.
 */
export function missingSlots(chosen: MirrorPiece[], wardrobe: Wardrobe, opts: { shoesPlaceable: boolean }): Slot[] {
  const slots = new Set(chosen.map((p) => slotOf(p.category)));
  if (chosen.some((p) => slotOf(p.category) === null)) return [];
  const out: Slot[] = [];
  const have = (s: Slot) => wardrobe.pieces.some((p) => slotOf(p.category) === s && !chosen.some((c) => c.id === p.id));
  if (!slots.has("onePiece")) {
    if (!slots.has("top") && have("top")) out.push("top");
    if (!slots.has("bottom") && have("bottom")) out.push("bottom");
  }
  if (!slots.has("shoes") && opts.shoesPlaceable && have("shoes")) out.push("shoes");
  return out;
}

/** The closet's pieces for a slot, minus what is already in the look: the Shop's suggestions for the chosen pieces first, then favorites, then the rest in the wardrobe's order. */
export function candidatesFor(slot: Slot, wardrobe: Wardrobe, chosenIds: string[]): (MirrorPiece & { suggested: boolean })[] {
  const suggested = new Set(chosenIds.flatMap((id) => wardrobe.goesWith[id] ?? []));
  return wardrobe.pieces
    .filter((p) => slotOf(p.category) === slot && !chosenIds.includes(p.id))
    .map((p) => ({ ...p, suggested: suggested.has(p.id) }))
    .sort((a, b) => Number(b.suggested) - Number(a.suggested) || Number(b.isFavorite) - Number(a.isFavorite));
}

/** A tapped piece takes the place of the look's piece in the same slot (a top for a top), or joins the look. */
export function swapIn(itemIds: string[], piece: MirrorPiece, wardrobe: Wardrobe): string[] {
  const slot = slotOf(piece.category);
  const byId = new Map(wardrobe.pieces.map((p) => [p.id, p]));
  const kept = itemIds.filter((id) => {
    const p = byId.get(id);
    if (!p || id === piece.id) return id !== piece.id;
    const s = slotOf(p.category);
    // a one-piece makes way for a top or a bottom, and the other way round
    if (slot === "onePiece") return s !== "top" && s !== "bottom" && s !== "onePiece";
    if (slot === "top" || slot === "bottom") return s !== slot && s !== "onePiece";
    return s !== slot;
  });
  return [...kept, piece.id];
}

export const SLOT_WORD: Record<Slot, { ask: string; skip: (chosen: MirrorPiece[]) => string }> = {
  top: { ask: "Add a top?", skip: (c) => (c.some((p) => slotOf(p.category) === "bottom") ? "Just the bottom" : "No top") },
  bottom: { ask: "Add a bottom?", skip: (c) => (c.some((p) => slotOf(p.category) === "top") ? "Just the top" : "No bottom") },
  shoes: { ask: "Add shoes?", skip: () => "No shoes" },
};

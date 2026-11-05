/**
 * Looks (Jeff, 2 Nov 2026, B1): the client-safe half. "I should be able to add a bunch of items to a look and then see
 * it on a mannequin or me, with it being a mix of all things to buy, some things to buy plus some in my closet, or my
 * entire closet." A look holds store finds and closet pieces together; the one without a name is the open look the
 * tray shows; naming it saves it under Fits → Looks.
 */

/** How many pieces a look holds (the mirror dresses up to three of them: a top, a bottom, shoes). */
export const MAX_LOOK_PIECES = 5;

export type StorePieceInput = {
  title: string; url?: string | null; storeName?: string | null; priceText?: string | null; imageUrl?: string | null;
  /** A picture already in the bucket (the Shop's judged piece). */ imageKey?: string | null;
  /** What the find was read as (Tops, Bottoms…): the slot it takes in the mirror. */ category?: string | null;
};
export type LookPieceInput = { itemId: string } | StorePieceInput;

export type LookPieceView = {
  id: string; kind: "closet" | "store"; name: string; thumbKey: string | null; imageUrl: string | null; url: string | null;
  storeName: string | null; priceText: string | null; category: string | null; itemId: string | null;
};
export type LookView = {
  id: string; personId: string; personName: string; name: string | null; savedAt: Date | null; pieces: LookPieceView[];
  /** The store finds. */ toBuy: number;
  /** Their prices added up, when every one reads as a number. */ total: number | null;
  canEdit: boolean;
};
export type LookSummary = { id: string; name: string; pieces: number; toBuy: number; savedAt: Date };

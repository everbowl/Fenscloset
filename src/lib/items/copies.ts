import type { LaundryStatus } from "@/generated/prisma/client";

/**
 * Identical pieces as one card (Jeff, 2 Nov 2026: "ten Kirkland Medium white crew necks: show one in the closet,
 * list ten"). A piece carries how many copies it stands for and how many are in the wash or at the cleaners;
 * `laundryStatus` stays the one word the closet, Today and the filters read (clean while any copy is clean).
 */
export type CopyCounts = { copies: number; dirtyCopies: number; cleanersCopies: number };
export const MAX_COPIES = 99;

export function cleanCopies(c: CopyCounts): number {
  return Math.max(0, c.copies - c.dirtyCopies - c.cleanersCopies);
}

/** The summary word: clean while any copy is clean; else in the wash when any is; else at the cleaners. */
export function laundrySummary(c: CopyCounts): LaundryStatus {
  if (cleanCopies(c) > 0) return "clean";
  return c.dirtyCopies > 0 ? "dirty" : "cleaners";
}

/** Counts for a whole stack set to one state (the three-state tap on a single piece). */
export function countsFor(copies: number, status: LaundryStatus): CopyCounts {
  const n = Math.max(1, copies);
  return { copies: n, dirtyCopies: status === "dirty" ? n : 0, cleanersCopies: status === "cleaners" ? n : 0 };
}

/** The counts a piece really has: a single piece follows its laundry word (older rows never carried counts); a stack keeps its counts within its copies. */
export function countsOf(it: CopyCounts & { laundryStatus: LaundryStatus }): CopyCounts {
  if (it.copies <= 1) return countsFor(1, it.laundryStatus);
  const copies = Math.min(MAX_COPIES, Math.max(1, it.copies));
  const dirty = Math.min(copies, Math.max(0, it.dirtyCopies));
  const cleaners = Math.min(copies - dirty, Math.max(0, it.cleanersCopies));
  return { copies, dirtyCopies: dirty, cleanersCopies: cleaners };
}

export type CopyAction = "one_dirty" | "one_cleaners" | "one_clean" | "all_clean";

/** One tap on a stack: one more in the wash, one more to the cleaners, one back clean, or wash day. */
export function applyCopyAction(c: CopyCounts, action: CopyAction): CopyCounts {
  const clean = cleanCopies(c);
  switch (action) {
    case "one_dirty": return clean > 0 ? { ...c, dirtyCopies: c.dirtyCopies + 1 } : c;
    case "one_cleaners": return clean > 0 ? { ...c, cleanersCopies: c.cleanersCopies + 1 } : c;
    case "one_clean": return c.dirtyCopies > 0 ? { ...c, dirtyCopies: c.dirtyCopies - 1 } : c.cleanersCopies > 0 ? { ...c, cleanersCopies: c.cleanersCopies - 1 } : c;
    case "all_clean": return { ...c, dirtyCopies: 0, cleanersCopies: 0 };
  }
}

/** "×10 · 7 clean" on a card, or "×10" when every copy is clean; nothing for a single piece. */
export function copiesWord(c: CopyCounts): string | null {
  if (c.copies <= 1) return null;
  const clean = cleanCopies(c);
  return clean === c.copies ? `×${c.copies}` : `×${c.copies} · ${clean} clean`;
}

/** The long form for the piece page: "7 clean · 2 in the wash · 1 at cleaners". */
export function copiesLine(c: CopyCounts): string {
  const clean = cleanCopies(c);
  return [`${clean} clean`, c.dirtyCopies ? `${c.dirtyCopies} in the wash` : null, c.cleanersCopies ? `${c.cleanersCopies} at cleaners` : null].filter(Boolean).join(" · ");
}

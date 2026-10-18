import { db } from "@/lib/db";
import { getRuleNumber } from "@/lib/rules";
import type { LikelySizes } from "@/lib/profiles/size-options";
export type { LikelySizes } from "@/lib/profiles/size-options";

/**
 * Sizes by item type (Jeff, 18 Oct 2026): the size options offered per category come from the
 * editable Sizes list (Admin → Lists → Sizes), measurements are picked from preloaded options,
 * and height + weight give "likely sizes" as a starting point. Nothing here is shared beyond the
 * body-data rules; likely sizes are computed on the fly, never stored.
 */

export type CategorySizes = { categoryId: string; categoryName: string; options: string[] };

/** Categories that have size options, in list order. */
export async function sizeOptionsByCategory(): Promise<CategorySizes[]> {
  const cats = await db.category.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, sizes: { where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { name: true } } } });
  return cats.filter((c) => c.sizes.length).map((c) => ({ categoryId: c.id, categoryName: c.name, options: c.sizes.map((s) => s.name) }));
}

const LETTERS = ["XS", "S", "M", "L", "XL", "XXL"] as const;
/** Dress number that sits in the middle of each letter band. */
const DRESS_BY_LETTER: Record<(typeof LETTERS)[number], string> = { XS: "2", S: "4", M: "8", L: "12", XL: "16", XXL: "18" };


/** Letter, waist and dress size a person's height and weight point to. Adults only; null when either number is missing. */
export async function likelySizes(ownerId: string): Promise<LikelySizes | null> {
  const person = await db.person.findUnique({ where: { id: ownerId }, select: { role: true } });
  if (!person || person.role === "minor") return null;
  const values = await db.bodyMeasurement.findMany({ where: { personId: ownerId }, include: { kind: true } });
  const num = (name: RegExp) => { const v = values.find((m) => name.test(m.kind.name)); const n = v ? Number(v.value) : NaN; return Number.isFinite(n) && n > 0 ? n : null; };
  const heightIn = num(/height/i), weightLb = num(/weight/i);
  if (!heightIn || !weightLb) return null;
  const [xs, s, m, l, xl, tall, short, divX10] = await Promise.all([
    getRuleNumber("sizeBandXsMaxLb", 125), getRuleNumber("sizeBandSMaxLb", 150), getRuleNumber("sizeBandMMaxLb", 180), getRuleNumber("sizeBandLMaxLb", 210), getRuleNumber("sizeBandXlMaxLb", 240),
    getRuleNumber("sizeTallIn", 74), getRuleNumber("sizeShortIn", 64), getRuleNumber("waistDivisorX10", 55),
  ]);
  let band = weightLb <= xs ? 0 : weightLb <= s ? 1 : weightLb <= m ? 2 : weightLb <= l ? 3 : weightLb <= xl ? 4 : 5;
  if (heightIn >= tall) band = Math.min(5, band + 1);
  if (heightIn <= short) band = Math.max(0, band - 1);
  const letter = LETTERS[band];
  // waist ≈ weight ÷ divisor, an inch off for every 2 inches above or below 5'10"
  const waist = Math.round(weightLb / (Math.max(10, divX10) / 10) - (heightIn - 70) / 2);
  return { letter, waist: String(Math.max(22, Math.min(60, waist))), dress: DRESS_BY_LETTER[letter], from: { heightIn, weightLb } };
}

export { likelyFor, measurementOptions, formatMeasurement } from "@/lib/profiles/size-options";

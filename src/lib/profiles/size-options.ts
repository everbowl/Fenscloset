/** Pure helpers for sizes and measurements (no database), safe for client components. */

type BrandSizes = { sizes: { categoryId: string | null; size: string }[] };
/** The size a person wears in a brand for a piece of this category (exact category, else the brand's "any" size, else its only size). */
export function sizeFor(brand: BrandSizes, categoryId: string | null): string | null {
  return brand.sizes.find((s) => s.categoryId === categoryId)?.size ?? brand.sizes.find((s) => s.categoryId === null)?.size ?? (brand.sizes.length === 1 ? brand.sizes[0].size : null);
}

export type LikelySizes = { letter: string; waist: string; dress: string; from: { heightIn: number; weightLb: number } };

/** The likely size for one category name, if the bands cover it. */
export function likelyFor(likely: LikelySizes | null, categoryName: string): string | null {
  if (!likely) return null;
  const n = categoryName.toLowerCase();
  if (n === "bottoms") return likely.waist;
  if (n === "dresses") return likely.dress;
  if (["tops", "outerwear", "activewear", "swimwear"].includes(n)) return likely.letter;
  return null;
}

/** Preloaded picker options for a measurement kind, from its name and unit; "Other…" stays open for anything else. */
export function measurementOptions(kind: { name: string; unit: string }): string[] {
  const n = kind.name.toLowerCase();
  const range = (from: number, to: number, step = 1) => { const out: string[] = []; for (let v = from; v <= to + 1e-9; v += step) out.push(Number.isInteger(v) ? String(v) : v.toFixed(1)); return out; };
  if (/height/.test(n)) return range(48, 84); // 4'0" to 7'0", stored in inches
  if (/weight/.test(n)) return range(60, 350, 5);
  if (/shoe/.test(n)) return range(4, 15, 0.5).map((m) => `M ${m} / W ${(Number(m) + 1.5).toString()}`); // men's and women's US side by side
  if (/chest|bust/.test(n)) return range(26, 60);
  if (/waist/.test(n)) return range(20, 56);
  if (/hip/.test(n)) return range(28, 64);
  if (/inseam/.test(n)) return range(22, 38);
  if (/shoulder/.test(n)) return range(13, 24);
  if (/sleeve/.test(n)) return range(26, 40);
  if (/neck/.test(n)) return range(12, 21);
  if (/cup/.test(n)) return ["AA", "A", "B", "C", "D", "DD", "DDD", "G", "H"];
  if (/hat/.test(n)) return ["XS", "S", "M", "L", "XL", "6 7/8", "7", "7 1/8", "7 1/4", "7 3/8", "7 1/2", "7 5/8", "7 3/4"];
  return [];
}

/** How a stored value reads: height in inches shows as 5'11". */
export function formatMeasurement(kind: { name: string; unit: string }, value: string): string {
  if (/height/i.test(kind.name) && kind.unit === "in") { const n = Number(value); if (Number.isFinite(n) && n > 0) return `${Math.floor(n / 12)}'${Math.round(n % 12)}"`; }
  return `${value}${kind.unit ? ` ${kind.unit}` : ""}`;
}

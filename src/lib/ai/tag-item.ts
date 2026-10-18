import { db } from "@/lib/db";
import { isMockAi, structured } from "@/lib/ai/claude";

export type Named = { id: string; name: string };
export type TagLists = {
  categories: (Named & { subcategories: Named[] })[];
  colors: Named[];
  patterns: Named[];
  fabrics: Named[];
  seasons: Named[];
  formalities: Named[];
  brands: Named[];
};

/** The AI's answer, already mapped onto list ids. Anything not in the lists is null/empty so the person picks. */
export type TagResult = {
  name: string;
  categoryId: string | null;
  subcategoryId: string | null;
  colorIds: string[];
  patternId: string | null;
  fabricId: string | null;
  fabricConfidence: number;
  seasonIds: string[];
  formalityId: string | null;
  brandText: string | null;
  brandId: string | null;
  sizeText: string | null;
  confidence: number;
  /** Raw names the model said, kept for the confirm screen's "(best guess)" notes and debugging. */
  raw: RawTags;
};

export type RawTags = {
  name: string;
  category: string;
  subcategory: string | null;
  colors: string[];
  pattern: string;
  fabric: string;
  fabricConfidence: number;
  seasons: string[];
  formality: string;
  brandText: string | null;
  sizeText: string | null;
  confidence: number;
};

const UNKNOWN = "unknown";

export async function loadTagLists(): Promise<TagLists> {
  const [categories, colors, patterns, fabrics, seasons, formalities, brands] = await Promise.all([
    db.category.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, subcategories: { where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } } } }),
    db.color.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.pattern.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.fabric.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.season.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.formalityLevel.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.brand.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  return { categories, colors, patterns, fabrics, seasons, formalities, brands };
}

const names = (xs: Named[]) => xs.map((x) => x.name);

/** JSON schema whose enums are built from the editable lists, so the model can only answer with real entries (or "unknown"). */
export function tagSchema(lists: TagLists): Record<string, unknown> {
  const withUnknown = (xs: Named[]) => [...names(xs), UNKNOWN];
  return {
    type: "object",
    additionalProperties: false,
    required: ["name", "category", "subcategory", "colors", "pattern", "fabric", "fabricConfidence", "seasons", "formality", "brandText", "sizeText", "confidence"],
    properties: {
      name: { type: "string", description: "Short item name a person would use, e.g. 'Black ribbed tank', 'Levi's 501 jeans'. 2–6 words." },
      category: { type: "string", enum: withUnknown(lists.categories) },
      subcategory: { anyOf: [{ type: "string", enum: [...new Set(lists.categories.flatMap((c) => names(c.subcategories)))] }, { type: "null" }], description: "Must belong to the chosen category." },
      colors: { type: "array", items: { type: "string", enum: names(lists.colors) }, description: "Dominant color first, at most three." },
      pattern: { type: "string", enum: withUnknown(lists.patterns) },
      fabric: { type: "string", enum: withUnknown(lists.fabrics) },
      fabricConfidence: { type: "number", description: "0 to 1." },
      seasons: { type: "array", items: { type: "string", enum: names(lists.seasons) } },
      formality: { type: "string", enum: withUnknown(lists.formalities) },
      brandText: { type: ["string", "null"], description: "Brand if a logo or label is readable, else null." },
      sizeText: { type: ["string", "null"], description: "Size if a label is readable (S, M, 28, 8…), else null." },
      confidence: { type: "number", description: "0 to 1: overall confidence that category and colors are right." },
    },
  };
}

const norm = (s: string) => s.trim().toLowerCase();
function findByName<T extends Named>(xs: T[], name: string | null | undefined): T | null {
  if (!name || norm(name) === UNKNOWN) return null;
  return xs.find((x) => norm(x.name) === norm(name)) ?? null;
}

/** Pure mapping from the model's names to list ids. Unknown names become null (never invented). */
export function mapTags(raw: RawTags, lists: TagLists): TagResult {
  const category = findByName(lists.categories, raw.category);
  const subcategory = category ? findByName(category.subcategories, raw.subcategory) : null;
  const colorIds = (raw.colors ?? []).map((c) => findByName(lists.colors, c)?.id).filter((x): x is string => Boolean(x));
  const brand = findByName(lists.brands, raw.brandText);
  const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
  return {
    name: (raw.name ?? "").trim().slice(0, 80) || "Untitled piece",
    categoryId: category?.id ?? null,
    subcategoryId: subcategory?.id ?? null,
    colorIds: [...new Set(colorIds)],
    patternId: findByName(lists.patterns, raw.pattern)?.id ?? null,
    fabricId: findByName(lists.fabrics, raw.fabric)?.id ?? null,
    fabricConfidence: clamp(raw.fabricConfidence),
    seasonIds: [...new Set((raw.seasons ?? []).map((s) => findByName(lists.seasons, s)?.id).filter((x): x is string => Boolean(x)))],
    formalityId: findByName(lists.formalities, raw.formality)?.id ?? null,
    brandText: raw.brandText?.trim() || null,
    brandId: brand?.id ?? null,
    sizeText: raw.sizeText?.trim() || null,
    confidence: clamp(raw.confidence),
    raw,
  };
}

const SYSTEM = `You tag clothing photos for a private family wardrobe app. Look at the single garment or accessory in the photo and answer with JSON only, using exactly the allowed list values. Pick "unknown" rather than guessing when a field is not visible. Colors: the garment's own colors, not the background or hanger. Seasons: every season the piece is reasonable to wear. Fabric: judge from texture and sheen; report your fabricConfidence honestly.`;

function mockRaw(lists: TagLists): RawTags {
  const pick = (xs: Named[], want: string) => xs.find((x) => norm(x.name) === norm(want))?.name ?? xs[0]?.name ?? UNKNOWN;
  const cat = lists.categories.find((c) => norm(c.name) === "tops") ?? lists.categories[0];
  return {
    name: "Mock black tee",
    category: cat?.name ?? UNKNOWN,
    subcategory: cat?.subcategories[0]?.name ?? null,
    colors: [pick(lists.colors, "Black")],
    pattern: pick(lists.patterns, "Solid"),
    fabric: pick(lists.fabrics, "Cotton"),
    fabricConfidence: 0.7,
    seasons: lists.seasons.slice(0, 2).map((s) => s.name),
    formality: pick(lists.formalities, "Casual"),
    brandText: null,
    sizeText: null,
    confidence: 0.9,
  };
}

/** Vision tagging constrained to the editable lists. `image` is base64 JPEG/PNG. */
export async function tagItem(opts: { image: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }; back?: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }; lists: TagLists }): Promise<TagResult> {
  const raw = isMockAi()
    ? mockRaw(opts.lists)
    : await structured<RawTags>({
        system: SYSTEM,
        prompt: opts.back ? "Tag this piece. The first photo is the front, the second is the back; use both (a graphic, print or cut may only show from behind)." : "Tag this piece.",
        image: opts.image,
        images: opts.back ? [{ label: "Back of the piece", ...opts.back }] : undefined,
        schema: tagSchema(opts.lists),
        effort: "low",
      });
  return mapTags(raw, opts.lists);
}

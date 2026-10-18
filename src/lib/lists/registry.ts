/**
 * Registry of every admin-editable list. Adding a list kind = one entry here (plus its Prisma model).
 * The generic service and the admin UI read everything else from this table.
 */
export const LIST_KINDS = [
  "category", "subcategory", "color", "pattern", "fabric", "season", "formality", "occasion",
  "tag", "brand", "store", "closet", "checkInScale", "checkInOption", "measurementKind", "styleWord",
] as const;
export type ListKind = (typeof LIST_KINDS)[number];

export type ExtraField = { name: "hex" | "url" | "unit" | "photoTip"; label: string; type: "color" | "url" | "text"; required?: boolean; placeholder?: string; maxLength?: number };

export type ListKindDef = {
  kind: ListKind;
  /** Plural label for headings. */
  label: string;
  /** Singular label for buttons ("+ Add brand"). */
  singular: string;
  /** Prisma delegate name on the client. */
  delegate: "category" | "subcategory" | "color" | "pattern" | "fabric" | "season" | "formalityLevel" | "occasion" | "tag" | "brand" | "store" | "closet" | "checkInScale" | "checkInOption" | "measurementKind" | "styleWord";
  extraFields: ExtraField[];
  /** For nested lists: which kind owns entries and which column stores the parent id. */
  parent?: { kind: ListKind; field: "categoryId" | "scaleId"; label: string };
  description: string;
};

export const LIST_DEFS: Record<ListKind, ListKindDef> = {
  category: { kind: "category", label: "Categories", singular: "category", delegate: "category", extraFields: [{ name: "photoTip", label: "Photo tip", type: "text", placeholder: "How to photograph this kind of piece", maxLength: 160 }], description: "Tops, bottoms, shoes… the main buckets every item lands in. The photo tip shows on Add clothes and in Help." },
  subcategory: { kind: "subcategory", label: "Subcategories", singular: "subcategory", delegate: "subcategory", extraFields: [], parent: { kind: "category", field: "categoryId", label: "Category" }, description: "Finer types inside a category, like T-shirt or Blouse inside Tops." },
  color: { kind: "color", label: "Colors", singular: "color", delegate: "color", extraFields: [{ name: "hex", label: "Swatch", type: "color", required: true }], description: "Colors the AI can tag and outfits can match on." },
  pattern: { kind: "pattern", label: "Patterns", singular: "pattern", delegate: "pattern", extraFields: [], description: "Solid, stripe, floral…" },
  fabric: { kind: "fabric", label: "Fabrics", singular: "fabric", delegate: "fabric", extraFields: [], description: "Cotton, denim, silk…" },
  season: { kind: "season", label: "Seasons", singular: "season", delegate: "season", extraFields: [], description: "When an item makes sense to wear." },
  formality: { kind: "formality", label: "Formality levels", singular: "formality level", delegate: "formalityLevel", extraFields: [], description: "From lounge to formal. Order matters: top is most casual." },
  occasion: { kind: "occasion", label: "Occasions", singular: "occasion", delegate: "occasion", extraFields: [], description: "What the day is for: work, gym, date night…" },
  tag: { kind: "tag", label: "Tags", singular: "tag", delegate: "tag", extraFields: [], description: "Free-form labels for anything else." },
  brand: { kind: "brand", label: "Brands", singular: "brand", delegate: "brand", extraFields: [], description: "Shared brand list. Each person picks favorites from it in their profile." },
  store: { kind: "store", label: "Stores", singular: "store", delegate: "store", extraFields: [{ name: "url", label: "Website", type: "url" }], description: "Where things get bought. Each person picks favorites in their profile." },
  closet: { kind: "closet", label: "Closets", singular: "closet", delegate: "closet", extraFields: [], description: "Personal closets, the Family closet, and any extra closets you want (e.g. Storage)." },
  checkInScale: { kind: "checkInScale", label: "Check-in scales", singular: "scale", delegate: "checkInScale", extraFields: [], description: "The daily check-in questions: tan, hair, skin." },
  measurementKind: { kind: "measurementKind", label: "Body measurements", singular: "measurement", delegate: "measurementKind", extraFields: [{ name: "unit", label: "Unit", type: "text", placeholder: "in · lb · US" }], description: "What a body profile records: height, waist, shoe size… Each person fills in their own numbers." },
  styleWord: { kind: "styleWord", label: "Style words", singular: "style word", delegate: "styleWord", extraFields: [], description: "Words people pick to describe their style: minimal, classic, streetwear…" },
  checkInOption: { kind: "checkInOption", label: "Check-in options", singular: "option", delegate: "checkInOption", extraFields: [], parent: { kind: "checkInScale", field: "scaleId", label: "Scale" }, description: "The answers available for each check-in scale." },
};

export function isListKind(value: string): value is ListKind {
  return (LIST_KINDS as readonly string[]).includes(value);
}

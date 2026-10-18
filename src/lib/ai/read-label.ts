import { isMockAi, structured } from "@/lib/ai/claude";

export type LabelResult = { brand: string | null; size: string | null; careNotes: string | null };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["brand", "size", "careNotes"],
  properties: {
    brand: { type: ["string", "null"], description: "Brand name exactly as printed, or null." },
    size: { type: ["string", "null"], description: "Size exactly as printed (M, 28x32, EU 38…), or null." },
    careNotes: { type: ["string", "null"], description: "Short care instruction if printed (e.g. 'Dry clean only'), else null." },
  },
};

/** Reads a photo of a garment label. Mock returns nothing readable. */
export async function readLabel(image: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }): Promise<LabelResult> {
  if (isMockAi()) return { brand: process.env.MOCK_LABEL_BRAND ?? null, size: process.env.MOCK_LABEL_SIZE ?? null, careNotes: null };
  return structured<LabelResult>({
    system: "You read clothing care/brand labels. Answer with JSON only. Copy text exactly as printed; use null when a field is not legible.",
    prompt: "Read this label.",
    image,
    schema: SCHEMA,
    effort: "low",
  });
}

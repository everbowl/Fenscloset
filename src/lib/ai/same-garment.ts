import { createHash } from "node:crypto";
import { isMockAi, structured } from "@/lib/ai/claude";

/**
 * "Is this the very same piece?" (Jeff, 19 Oct 2026): ten black shirts from different brands must not
 * ask "looks like one you own". The photo hash only shortlists; Claude looks at both pictures and
 * says whether they show the same garment (same cut, print, logo, hardware), not merely the same kind.
 * MOCK_AI: same only when the two pictures are byte-identical.
 */
export async function sameGarment(a: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }, b: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }): Promise<{ same: boolean; confidence: number }> {
  if (isMockAi()) {
    const h = (x: string) => createHash("sha1").update(x).digest("hex");
    return { same: h(a.data) === h(b.data), confidence: 1 };
  }
  try {
    const out = await structured<{ same: boolean; confidence: number; why: string }>({
      system: "You compare two clothing photos for a private wardrobe app. Answer with JSON only.",
      prompt: "Is the garment in the second photo the SAME physical piece (or an identical twin of it: same brand style, same color, same print or logo, same cut, same hardware) as the garment in the first? Two different black t-shirts are NOT the same. A photo of the same piece from another angle, folded or on a hanger IS the same. Be strict: when in doubt, answer false.",
      image: a,
      images: [{ label: "Second photo", ...b }],
      schema: { type: "object", additionalProperties: false, required: ["same", "confidence", "why"], properties: { same: { type: "boolean" }, confidence: { type: "number", description: "0 to 1" }, why: { type: "string" } } },
      effort: "low",
    });
    return { same: Boolean(out.same) && out.confidence >= 0.7, confidence: out.confidence };
  } catch { return { same: false, confidence: 0 }; }
}

import sharp from "sharp";
import { isMockAi, structured } from "@/lib/ai/claude";

/**
 * Before a garment picture goes to the try-on model, a quick look: does the whole piece show, hem to
 * collar, cuff to cuff? A photo with the bottom folded under, cut off by the frame or hidden makes the
 * model dress the person in a cropped version of it (Jeff, 19 Oct 2026: a polo came out as a crop top).
 * The answer is kept on the photo (ItemPhoto.wholeGarment), so each picture is looked at once.
 * MOCK_AI: whole unless MOCK_GARMENT_WHOLE=false. Without an Anthropic key the check is skipped (whole).
 */
export type GarmentCheck = { whole: boolean; problem: string | null };

const SYSTEM = "You check product photos for a virtual try-on. Answer with JSON only.";
const PROMPT = "Is the ENTIRE garment visible in this photo, nothing cut off by the frame, folded under, rolled, bunched or hidden? For a top: collar/neckline, both sleeves to the cuff and the full hem. For bottoms: waistband to both hem ends. For shoes: the whole pair. Small wrinkles are fine. whole=true only when a try-on model could dress someone in the complete piece from this picture alone; otherwise whole=false and say in a few words what is missing.";
const SCHEMA = { type: "object", additionalProperties: false, required: ["whole", "problem"], properties: { whole: { type: "boolean" }, problem: { type: ["string", "null"], description: "What is missing or hidden, in a few words; null when whole." } } };

export function isGarmentCheckAvailable(): boolean {
  return isMockAi() || Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function checkWholeGarment(image: Buffer): Promise<GarmentCheck> {
  if (isMockAi()) return process.env.MOCK_GARMENT_WHOLE === "false" ? { whole: false, problem: "mock: the hem is cut off" } : { whole: true, problem: null };
  if (!process.env.ANTHROPIC_API_KEY) return { whole: true, problem: null };
  const jpeg = await sharp(image).rotate().flatten({ background: "#ffffff" }).resize(768, 768, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const r = await structured<{ whole: boolean; problem: string | null }>({ system: SYSTEM, prompt: PROMPT, image: { data: jpeg.toString("base64"), mediaType: "image/jpeg" }, schema: SCHEMA, effort: "low" });
  return { whole: Boolean(r.whole), problem: r.whole ? null : (r.problem ?? "part of the piece is not visible") };
}

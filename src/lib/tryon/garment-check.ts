import sharp from "sharp";
import { isMockAi, structured } from "@/lib/ai/claude";

/**
 * Two looks by Claude around the try-on model (Jeff, 19 Oct 2026: a polo came out as a crop top, a tee with a
 * hole in the back and no front).
 *
 * 1. Before a garment picture goes to the model: does the whole piece show, hem to collar, cuff to cuff, with
 *    nothing cut off, folded under, or missing inside the outline (a background-removal hole, an AI re-draw that
 *    shortened it)? The answer is kept on the photo (ItemPhoto.wholeGarment), so each picture is looked at once.
 * 2. After the model dresses the person: is each garment worn as it really is (full length, no holes, no missing
 *    panels, same color)? A failed render is re-done with the second model, and the note shows in the mirror.
 *
 * MOCK_AI: whole unless MOCK_GARMENT_WHOLE=false; the render passes unless MOCK_RENDER_OK=false. Without an
 * Anthropic key both checks are skipped (whole / ok).
 */
export type GarmentCheck = { whole: boolean; problem: string | null };
export type RenderCheck = { ok: boolean; problem: string | null };

const SYSTEM = "You check pictures for a virtual try-on in a private family closet app. Answer with JSON only, strictly.";
const WHOLE_PROMPT = "Is the ENTIRE garment in this photo usable as the product picture for a virtual try-on? whole=true only when ALL of these hold: nothing is cut off by the frame; nothing is folded under, rolled or bunched so that the true length is hidden; the hem, both sleeves to the cuff and the neckline (for a top) or the waistband and both hem ends (for bottoms) are all visible; and the inside of the garment's outline is intact: no hole, no see-through or white or transparent patch, no missing front or back panel, no cut-out shape (these come from background removal or an AI re-draw and make the model dress the person in a damaged version). Small wrinkles, a plain or cluttered background and a hanger are fine. Otherwise whole=false and say in a few words what is wrong.";
const WHOLE_SCHEMA = { type: "object", additionalProperties: false, required: ["whole", "problem"], properties: { whole: { type: "boolean" }, problem: { type: ["string", "null"], description: "What is missing, hidden or damaged, in a few words; null when whole." } } };

const RENDER_PROMPT = "The first image is a virtual try-on result: a person dressed by a model. Each image after it is a garment the person should be wearing, as it really is. For EVERY garment decide whether the result shows it worn correctly and completely: the same length as in its own photo (a top reaches the hip or below unless its photo shows a cropped cut; it must not stop above the waist), the same color and print, no hole, no see-through patch, no missing or cut-away front, back or side panel, both sleeves present, the garment as one continuous piece. Ignore the pose, the background, tucking and small wrinkles. ok=true only when every garment passes; otherwise ok=false and name the garment and what is wrong in a few words.";
const RENDER_SCHEMA = { type: "object", additionalProperties: false, required: ["ok", "problem"], properties: { ok: { type: "boolean" }, problem: { type: ["string", "null"], description: "Which garment is wrong and how, in a few words; null when all pass." } } };

export function isGarmentCheckAvailable(): boolean {
  return isMockAi() || Boolean(process.env.ANTHROPIC_API_KEY);
}

async function small(image: Buffer, size = 768): Promise<string> {
  return (await sharp(image).rotate().flatten({ background: "#ffffff" }).resize(size, size, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()).toString("base64");
}

export async function checkWholeGarment(image: Buffer): Promise<GarmentCheck> {
  if (isMockAi()) return process.env.MOCK_GARMENT_WHOLE === "false" ? { whole: false, problem: "mock: the hem is cut off" } : { whole: true, problem: null };
  if (!process.env.ANTHROPIC_API_KEY) return { whole: true, problem: null };
  const r = await structured<{ whole: boolean; problem: string | null }>({ system: SYSTEM, prompt: WHOLE_PROMPT, image: { data: await small(image), mediaType: "image/jpeg" }, schema: WHOLE_SCHEMA, effort: "low" });
  return { whole: Boolean(r.whole), problem: r.whole ? null : (r.problem ?? "part of the piece is not visible") };
}

/** Does the dressed picture show each garment as it really is? `garments` are the pictures the model was given, with the piece's name. */
export async function checkRender(result: Buffer, garments: { name: string; buf: Buffer }[]): Promise<RenderCheck> {
  if (isMockAi()) return process.env.MOCK_RENDER_OK === "false" ? { ok: false, problem: "mock: the top stops above the waist" } : { ok: true, problem: null };
  if (!process.env.ANTHROPIC_API_KEY || !garments.length) return { ok: true, problem: null };
  const images = await Promise.all(garments.map(async (g) => ({ label: `Garment to check: ${g.name}`, data: await small(g.buf, 640), mediaType: "image/jpeg" as const })));
  const r = await structured<{ ok: boolean; problem: string | null }>({ system: SYSTEM, prompt: RENDER_PROMPT, image: { data: await small(result, 896), mediaType: "image/jpeg" }, images, schema: RENDER_SCHEMA, effort: "low" });
  return { ok: Boolean(r.ok), problem: r.ok ? null : (r.problem ?? "a garment is not worn as it really is") };
}

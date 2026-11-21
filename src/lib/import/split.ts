import sharp from "sharp";
import { db } from "@/lib/db";
import { isMockAi, structured } from "@/lib/ai/claude";
import { getObject, newKey, putObject } from "@/lib/storage";
import { normalizeOriginal, toAiImage } from "@/lib/images/thumb";
import { enqueueProcessing } from "@/lib/import/queue";
import { ImportError } from "@/lib/import/service";

/**
 * Several shirts in one photo (Jeff, 2 Nov 2026, E1): Claude finds each garment laid out in the picture and its
 * color; every garment is cropped out as its own photo and becomes its own entry in the same batch, ready for
 * the normal card. Pieces of the same color become one entry with that many copies.
 */

export type PieceBox = { left: number; top: number; width: number; height: number; color: string };
const MAX_PIECES = 12;

/** The garments in the photo as boxes (fractions of the photo, 0..1) with a color each. Mock: even strips, colors from MOCK_PIECE_COLORS. */
export async function findPieces(image: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }): Promise<PieceBox[]> {
  if (isMockAi()) {
    const n = Math.min(MAX_PIECES, Math.max(1, Number(process.env.MOCK_PIECE_COUNT ?? 2) || 2));
    const colors = (process.env.MOCK_PIECE_COLORS ?? "Black,White,Navy,Grey,Olive,Red").split(",").map((c) => c.trim()).filter(Boolean);
    return Array.from({ length: n }, (_, i) => ({ left: i / n, top: 0, width: 1 / n, height: 1, color: colors[i % colors.length] }));
  }
  const schema = {
    type: "object", additionalProperties: false, required: ["pieces"],
    properties: {
      pieces: {
        type: "array",
        description: "One entry per separate garment in the photo, left to right then top to bottom. Up to 12. A single garment gives one entry covering it.",
        items: {
          type: "object", additionalProperties: false, required: ["left", "top", "width", "height", "color"],
          properties: {
            left: { type: "number", description: "Left edge of the garment's box as a fraction of the photo width, 0 to 1." },
            top: { type: "number", description: "Top edge as a fraction of the photo height, 0 to 1." },
            width: { type: "number", description: "Box width as a fraction of the photo width, 0 to 1. Include the whole garment with a little margin." },
            height: { type: "number", description: "Box height as a fraction of the photo height, 0 to 1." },
            color: { type: "string", description: "The garment's main color in one or two plain words (Black, Navy, Heather grey). Garments of the same color get the same word." },
          },
        },
      },
    },
  };
  const out = await structured<{ pieces: PieceBox[] }>({
    system: "You find the separate garments laid out in one photo and give a tight box for each. Answer with JSON only.",
    prompt: "Give a box and a color for every separate garment in this photo.",
    image, schema, effort: "low", maxTokens: 800,
  });
  return (out.pieces ?? []).slice(0, MAX_PIECES).map((b) => ({
    left: clamp01(b.left), top: clamp01(b.top), width: clamp01(b.width), height: clamp01(b.height), color: String(b.color ?? "").trim().slice(0, 40) || "Unknown",
  })).filter((b) => b.width > 0.02 && b.height > 0.02);
}

const clamp01 = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));

/** Crop one box out of the photo, with a 2% margin, as a JPEG. */
async function cropBox(photo: Buffer, box: PieceBox): Promise<Buffer> {
  const meta = await sharp(photo).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  const m = 0.02;
  const left = Math.max(0, Math.floor((box.left - m) * W));
  const top = Math.max(0, Math.floor((box.top - m) * H));
  const right = Math.min(W, Math.ceil((box.left + box.width + m) * W));
  const bottom = Math.min(H, Math.ceil((box.top + box.height + m) * H));
  return sharp(photo).extract({ left, top, width: Math.max(8, right - left), height: Math.max(8, bottom - top) }).jpeg({ quality: 92 }).toBuffer();
}

/**
 * Split an entry's photo into its garments: one new entry per color (with the count as copies), each queued for
 * tagging in the same batch; the original entry steps aside as skipped. Returns the new entry ids.
 */
export async function splitEntry(personId: string, entryId: string): Promise<{ entryIds: string[]; pieces: number }> {
  const entry = await db.importEntry.findUnique({ where: { id: entryId }, include: { batch: true } });
  if (!entry || entry.batch.personId !== personId) throw new ImportError("That photo is not in your pile.", 404);
  if (entry.status !== "needs_confirm" && entry.status !== "uploaded") throw new ImportError(entry.status === "done" ? "That one is already in the closet." : "That photo is still being tagged.", 409);
  const photo = await normalizeOriginal((await getObject(entry.originalKey)).body);
  const boxes = await findPieces(await toAiImage(photo));
  if (boxes.length < 2) throw new ImportError("Only one piece was found in that photo. Keep it as one card, or take the pieces one at a time.");
  // The same color twice is one card with two copies (F): the first crop is its photo.
  const groups = new Map<string, { box: PieceBox; count: number }>();
  for (const b of boxes) {
    const key = b.color.toLowerCase();
    const g = groups.get(key);
    if (g) g.count += 1; else groups.set(key, { box: b, count: 1 });
  }
  const last = await db.importEntry.aggregate({ where: { batchId: entry.batchId }, _max: { order: true } });
  let order = (last._max.order ?? -1) + 1;
  const entryIds: string[] = [];
  for (const g of groups.values()) {
    const key = newKey("originals", personId, "image/jpeg");
    await putObject(key, await cropBox(photo, g.box), "image/jpeg");
    const made = await db.importEntry.create({ data: { batchId: entry.batchId, order: order++, originalKey: key, status: "uploaded", quantity: g.count } });
    entryIds.push(made.id);
  }
  await db.$transaction([
    db.importBatch.update({ where: { id: entry.batchId }, data: { total: { increment: entryIds.length }, status: "open" } }),
    db.importEntry.update({ where: { id: entryId }, data: { status: "skipped", aiResult: JSON.parse(JSON.stringify({ ...((entry.aiResult as object | null) ?? {}), splitInto: entryIds })) } }),
  ]);
  for (const id of entryIds) enqueueProcessing(id);
  return { entryIds, pieces: boxes.length };
}

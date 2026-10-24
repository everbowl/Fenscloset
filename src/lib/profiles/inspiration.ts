import { db } from "@/lib/db";
import { isMockAi, structured } from "@/lib/ai/claude";
import { getObject, parseKey } from "@/lib/storage";
import { toAiImage } from "@/lib/images/thumb";
import { ProfileError } from "@/lib/profiles/service";
import type { Viewer } from "@/lib/people/visibility";

/**
 * Inspiration board: screenshots of looks the person wants to look like (Instagram, Pinterest, a
 * magazine). Claude reads each into "style DNA" that every suggestion then imitates. Photos live
 * under `inspo/<personId>/…`: the owner's, plus a minor's parents. Only the image goes to Claude.
 */

export type StyleDna = {
  summary: string;
  silhouettes: string[];
  colorPairs: string[];
  formality: string;
  pieces: string[];
  words: string[];
};

export type InspirationView = { id: string; key: string; createdAt: string; notes: StyleDna };

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One sentence (max 20 words) on why this look works." },
    silhouettes: { type: "array", items: { type: "string" }, description: "1 to 3, e.g. 'relaxed straight-leg trouser', 'cropped boxy jacket'." },
    colorPairs: { type: "array", items: { type: "string" }, description: "1 to 3 pairings seen, e.g. 'camel + black'." },
    formality: { type: "string", description: "One of: casual, smart casual, dressy, formal, athletic." },
    pieces: { type: "array", items: { type: "string" }, description: "The pieces that make the look, 2 to 6, plain words." },
    words: { type: "array", items: { type: "string" }, description: "2 to 4 style words, e.g. 'minimal', 'tonal', 'preppy'." },
  },
  required: ["summary", "silhouettes", "colorPairs", "formality", "pieces", "words"], additionalProperties: false,
} as const;

async function assertCanEdit(viewer: Viewer, ownerId: string) {
  if (viewer.id === ownerId) return;
  const link = await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: ownerId, parentId: viewer.id } } });
  if (!link) throw new ProfileError("Only the owner or their parent can change this.", 403);
}

async function readLook(key: string): Promise<StyleDna> {
  if (isMockAi()) return { summary: "Mock: tonal neutrals with one sharp line.", silhouettes: ["relaxed straight-leg trouser", "cropped jacket"], colorPairs: ["camel + black"], formality: "smart casual", pieces: ["camel coat", "black turtleneck", "straight trousers", "loafers"], words: ["minimal", "tonal"] };
  const obj = await getObject(key);
  const image = await toAiImage(obj.body);
  return structured<StyleDna>({
    system: "You read a photo or screenshot of an outfit someone saved because they want to dress like this. Describe the look's style DNA in plain words, using only the given fields. Describe the clothes, never the person's body or face.",
    prompt: "Read this look.", image, schema: SCHEMA, effort: "low", maxTokens: 500,
  });
}

export async function addInspiration(viewer: Viewer, ownerId: string, key: string): Promise<InspirationView> {
  await assertCanEdit(viewer, ownerId);
  const parsed = parseKey(key);
  if (!parsed || parsed.kind !== "inspo" || parsed.ownerId !== ownerId) throw new ProfileError("That photo is not this person's.", 403);
  const notes = await readLook(key);
  const row = await db.inspirationLook.create({ data: { personId: ownerId, bucketKey: key, notes } });
  return { id: row.id, key: row.bucketKey, createdAt: row.createdAt.toISOString(), notes };
}

export async function listInspiration(ownerId: string): Promise<InspirationView[]> {
  const rows = await db.inspirationLook.findMany({ where: { personId: ownerId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({ id: r.id, key: r.bucketKey, createdAt: r.createdAt.toISOString(), notes: r.notes as StyleDna }));
}

export async function removeInspiration(viewer: Viewer, ownerId: string, id: string): Promise<string | null> {
  await assertCanEdit(viewer, ownerId);
  const row = await db.inspirationLook.findUnique({ where: { id } });
  if (!row || row.personId !== ownerId) throw new ProfileError("Not yours.", 403);
  await db.inspirationLook.delete({ where: { id } });
  return row.bucketKey;
}

/** Prompt block from the newest looks, or "" when the board is empty. */
export async function inspirationContext(personId: string): Promise<string> {
  const looks = await listInspiration(personId);
  if (!looks.length) return "";
  const recent = looks.slice(0, 8);
  const count = (xs: string[]) => { const m = new Map<string, number>(); xs.forEach((x) => m.set(x.toLowerCase(), (m.get(x.toLowerCase()) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k); };
  const words = count(recent.flatMap((l) => l.notes.words)).slice(0, 6);
  const silhouettes = count(recent.flatMap((l) => l.notes.silhouettes)).slice(0, 5);
  const pairs = count(recent.flatMap((l) => l.notes.colorPairs)).slice(0, 5);
  const formality = count(recent.map((l) => l.notes.formality)).slice(0, 2);
  return [
    `Inspiration board (${looks.length} saved looks they want to dress like; imitate this feel with the pieces they own):`,
    words.length ? `- Words: ${words.join(", ")}` : null,
    silhouettes.length ? `- Silhouettes: ${silhouettes.join("; ")}` : null,
    pairs.length ? `- Color pairings: ${pairs.join("; ")}` : null,
    formality.length ? `- Formality: ${formality.join(", ")}` : null,
    ...recent.slice(0, 3).map((l) => `- "${l.notes.summary}"`),
  ].filter(Boolean).join("\n");
}

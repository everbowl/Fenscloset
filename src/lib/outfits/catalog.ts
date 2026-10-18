import { db } from "@/lib/db";
import { getRuleNumber, getTimezone } from "@/lib/rules";
import { dayKey } from "@/lib/dates";

/** A wearable piece as the engine and the boards see it. */
export type Candidate = {
  id: string;
  name: string;
  ownerId: string;
  category: string | null;
  subcategory: string | null;
  colors: string[];
  pattern: string | null;
  fabric: string | null;
  seasons: string[];
  formality: string | null;
  occasions: string[];
  brand: string | null;
  isFavorite: boolean;
  wearCount: number;
  lastWornAt: Date | null;
  thumbKey: string | null;
};

export type CandidateSet = { usable: Candidate[]; restingIds: string[]; noRepeatDays: number };

const select = {
  id: true, name: true, ownerId: true, isFavorite: true, wearCount: true, lastWornAt: true,
  category: { select: { name: true } }, subcategory: { select: { name: true } }, brand: { select: { name: true } },
  colors: { select: { name: true } }, patterns: { select: { name: true } }, fabrics: { select: { name: true } },
  seasons: { select: { name: true } }, formalities: { select: { name: true } }, occasions: { select: { name: true } },
  photos: { where: { kind: "thumb" as const }, take: 1, select: { bucketKey: true } },
};

/**
 * What a person may wear today: their own pieces plus the Family closet, minus laundry, never-suggest,
 * retired, and anything worn inside the no-repeat window (those are "resting"; the engine falls back to them
 * only when the usable set is too small, and says so).
 */
export async function loadCandidates(personId: string, now = new Date(), opts: { noRepeatDays?: number } = {}): Promise<CandidateSet> {
  const noRepeatDays = opts.noRepeatDays ?? (await getRuleNumber("noRepeatDays", 14));
  const items = await db.item.findMany({
    where: {
      OR: [{ ownerId: personId }, { closets: { some: { closet: { kind: "family" } } } }],
      laundryStatus: "clean", neverSuggest: false, retiredAt: null,
    },
    select, orderBy: { createdAt: "asc" },
  });
  const cutoff = now.getTime() - noRepeatDays * 24 * 3600 * 1000;
  // Pieces worn earlier today are not "resting": you are wearing them, and Together / More looks may still use them.
  const tz = await getTimezone();
  const today = dayKey(now, tz);
  const all = items.map<Candidate>((it) => ({
    id: it.id, name: it.name ?? "Untitled piece", ownerId: it.ownerId,
    category: it.category?.name ?? null, subcategory: it.subcategory?.name ?? null,
    colors: it.colors.map((c) => c.name), pattern: it.patterns[0]?.name ?? null, fabric: it.fabrics[0]?.name ?? null,
    seasons: it.seasons.map((s) => s.name), formality: it.formalities[0]?.name ?? null, occasions: it.occasions.map((o) => o.name),
    brand: it.brand?.name ?? null, isFavorite: it.isFavorite, wearCount: it.wearCount, lastWornAt: it.lastWornAt, thumbKey: it.photos[0]?.bucketKey ?? null,
  }));
  const resting = all.filter((c) => c.lastWornAt && c.lastWornAt.getTime() > cutoff && dayKey(c.lastWornAt, tz) !== today);
  return { usable: all.filter((c) => !resting.includes(c)), restingIds: resting.map((c) => c.id), noRepeatDays };
}

/** One compact line per piece for the prompt. `#n` codes keep ids out of the model's output. */
export function describe(c: Candidate, code: string, now = new Date()): string {
  const parts = [
    [c.category, c.subcategory].filter(Boolean).join("/") || "uncategorized",
    c.colors.length ? `colors: ${c.colors.join(", ")}` : null,
    c.pattern ? `pattern: ${c.pattern}` : null,
    c.fabric ? `fabric: ${c.fabric}` : null,
    c.seasons.length ? `seasons: ${c.seasons.join(", ")}` : null,
    c.formality ? `formality: ${c.formality}` : null,
    c.occasions.length ? `occasions: ${c.occasions.join(", ")}` : null,
    c.brand ? `brand: ${c.brand}` : null,
    c.wearCount ? `worn ${c.wearCount}×${c.lastWornAt ? `, last ${Math.round((now.getTime() - c.lastWornAt.getTime()) / 86400000)}d ago` : ""}` : "never worn",
    c.isFavorite ? "favorite" : null,
  ].filter(Boolean);
  return `${code} ${c.name} — ${parts.join("; ")}`;
}

/** The style profile lines the engine may use (loved/avoid colors, style words, fit notes — for the owner's own looks only). */
export async function styleContext(personId: string): Promise<string> {
  const p = await db.person.findUniqueOrThrow({ where: { id: personId }, select: { name: true, role: true, lovedColors: { select: { name: true } }, avoidColors: { select: { name: true } }, styleWords: { select: { name: true } }, bodyProfile: { select: { fitNotes: true } } } });
  const lines = [
    p.lovedColors.length ? `Loves colors: ${p.lovedColors.map((c) => c.name).join(", ")}` : null,
    p.avoidColors.length ? `Avoids colors: ${p.avoidColors.map((c) => c.name).join(", ")}` : null,
    p.styleWords.length ? `Style words: ${p.styleWords.map((w) => w.name).join(", ")}` : null,
    p.bodyProfile?.fitNotes ? `Fit notes: ${p.bodyProfile.fitNotes}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

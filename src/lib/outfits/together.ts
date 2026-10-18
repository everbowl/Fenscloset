import { db } from "@/lib/db";
import { isMockAi, structured } from "@/lib/ai/claude";
import { describe, loadCandidates, styleContext, type Candidate } from "@/lib/outfits/catalog";
import { inputsFrom, OutfitError, type Board, type DayContext, type Piece } from "@/lib/outfits/engine";
import type { Viewer } from "@/lib/people/visibility";
import type { TogetherMode } from "@/generated/prisma/client";

/**
 * Together mode: one look per person for the same plan, in one Claude call so the looks relate.
 * coordinate = same vibe, complementary colors · match = clearly matching colors/pieces · contrast = deliberately different.
 */

export type TogetherBoard = { personId: string; personName: string; board: Board; pieces: Piece[]; suggestionId: string; wornFitId: string | null };
export type TogetherView = { id: string; mode: TogetherMode; occasionLabel: string | null; date: string; boards: TogetherBoard[] };

const MODE_TEXT: Record<TogetherMode, string> = {
  coordinate: "COORDINATE: the looks share a mood and palette without copying each other.",
  match: "MATCH: the looks visibly match — same colors or twin pieces where the closets allow.",
  contrast: "CONTRAST: the looks are deliberately different in color and formality, and still work side by side.",
};

/** The people a viewer may put in a Together session: themselves, anyone whose closet they can see (minors only with their parents). */
export async function togetherPeople(viewer: Viewer): Promise<{ id: string; name: string }[]> {
  const people = await db.person.findMany({ where: { status: { not: "removed" } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, role: true, guardians: { select: { parentId: true } } } });
  return people.filter((p) => p.role !== "minor" || p.id === viewer.id || p.guardians.some((g) => g.parentId === viewer.id)).map((p) => ({ id: p.id, name: p.name.split(" ")[0] }));
}

export async function createTogether(viewer: Viewer, opts: { personIds: string[]; mode: TogetherMode; occasionId?: string | null; occasionText?: string | null; date: string; ctx: DayContext }): Promise<TogetherView> {
  const allowed = await togetherPeople(viewer);
  const ids = [...new Set(opts.personIds)].filter((id) => allowed.some((a) => a.id === id));
  if (ids.length < 2) throw new OutfitError("Pick at least two people.");
  const occasion = opts.occasionId ? await db.occasion.findFirst({ where: { id: opts.occasionId, isArchived: false } }) : null;
  const label = occasion?.name ?? opts.occasionText?.trim() ?? null;
  const now = opts.ctx.now ?? new Date();
  const per = await Promise.all(ids.map(async (id) => ({ id, name: allowed.find((a) => a.id === id)!.name, cand: await loadCandidates(id, now), style: await styleContext(id) })));
  const ctx: DayContext = { ...opts.ctx, plan: label ? { source: "pick", occasionId: occasion?.id ?? null, label } : opts.ctx.plan };
  const boards = await composeTogether(per, opts.mode, ctx, now);
  const session = await db.togetherSession.create({ data: { mode: opts.mode, occasionId: occasion?.id, occasionText: occasion ? null : label, createdById: viewer.id, date: opts.date, people: { create: ids.map((personId) => ({ personId })) } } });
  for (const p of per) {
    const b = boards.get(p.id);
    await db.outfitSuggestion.create({ data: { personId: p.id, date: opts.date, togetherSessionId: session.id, inputs: inputsFrom(ctx, p.cand) as object, outfits: (b ? [b] : []) as object[] } });
  }
  return (await getTogether(viewer, session.id))!;
}

async function composeTogether(per: { id: string; name: string; cand: { usable: Candidate[] }; style: string }[], mode: TogetherMode, ctx: DayContext, now: Date): Promise<Map<string, Board>> {
  const result = new Map<string, Board>();
  if (isMockAi()) {
    for (const p of per) {
      const byCat = new Map<string, Candidate>();
      for (const c of p.cand.usable) if (!byCat.has(c.category ?? "?")) byCat.set(c.category ?? "?", c);
      const ids = [...byCat.values()].slice(0, 4).map((c) => c.id);
      if (ids.length >= 2) result.set(p.id, { itemIds: ids, reason: `Mock ${mode} look for ${p.name}.` });
    }
    return result;
  }
  const codes = new Map<string, Candidate>();
  const sections = per.map((p) => {
    const lines = p.cand.usable.map((c) => { const code = `${p.name[0].toUpperCase()}${codes.size + 1}`; codes.set(code, c); return describe(c, code, now); });
    return `${p.name}'s pieces (codes start with ${p.name[0].toUpperCase()}):\n${p.style ? `Style: ${p.style.replace(/\n/g, "; ")}\n` : ""}${lines.join("\n")}`;
  });
  const inputs = inputsFrom(ctx, { restingIds: [], noRepeatDays: 0 });
  const prompt = [
    `Dress these ${per.length} people together. ${MODE_TEXT[mode]}`,
    inputs.weather ? `Weather: ${inputs.weather.nowF}° now → ${inputs.weather.tonightF}° tonight, ${inputs.weather.condition}` : "Weather: unknown",
    inputs.plan.label ? `Plan: ${inputs.plan.label}` : "Plan: everyday",
    ...sections,
    "Return exactly one look per person using only that person's own codes.",
  ].join("\n\n");
  const schema = { type: "object", properties: { looks: { type: "array", items: { type: "object", properties: { person: { type: "string", enum: per.map((p) => p.name) }, codes: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 }, reason: { type: "string" } }, required: ["person", "codes", "reason"], additionalProperties: false } } }, required: ["looks"], additionalProperties: false };
  const out = await structured<{ looks: { person: string; codes: string[]; reason: string }[] }>({
    system: "You are a personal stylist dressing a family together. Use only the numbered pieces given, each person's own codes only. One short warm reason per person (max 20 words). No emoji.",
    prompt, schema, effort: "medium", maxTokens: 1500,
  });
  for (const look of out.looks) {
    const p = per.find((x) => x.name === look.person);
    if (!p) continue;
    const ids = [...new Set(look.codes.map((c) => codes.get(c.trim())).filter((c): c is Candidate => Boolean(c) && p.cand.usable.some((u) => u.id === c!.id)).map((c) => c.id))];
    if (ids.length >= 2) result.set(p.id, { itemIds: ids, reason: look.reason.trim() });
  }
  return result;
}

export async function getTogether(viewer: Viewer, sessionId: string): Promise<TogetherView | null> {
  const s = await db.togetherSession.findUnique({ where: { id: sessionId }, include: { occasion: true, people: { include: { person: { select: { id: true, name: true } } } }, suggestions: { include: { fits: { select: { id: true } } } } } });
  if (!s) return null;
  if (!s.people.some((p) => p.personId === viewer.id) && s.createdById !== viewer.id) return null;
  const boards: TogetherBoard[] = [];
  for (const p of s.people) {
    const sug = s.suggestions.find((x) => x.personId === p.personId);
    const board = (sug?.outfits as Board[] | undefined)?.[0];
    if (!sug || !board) continue;
    const items = await db.item.findMany({ where: { id: { in: board.itemIds } }, select: { id: true, name: true, ownerId: true, category: { select: { name: true } }, subcategory: { select: { name: true } }, photos: { where: { kind: "thumb" }, take: 1, select: { bucketKey: true } } } });
    const pieces = board.itemIds.map((id) => items.find((it) => it.id === id)).filter(Boolean).map((it) => ({ id: it!.id, name: it!.name ?? "Untitled piece", label: (it!.subcategory?.name ?? it!.category?.name ?? "piece").toUpperCase(), thumbKey: it!.photos[0]?.bucketKey ?? null, ownerId: it!.ownerId }));
    boards.push({ personId: p.personId, personName: p.person.name.split(" ")[0], board, pieces, suggestionId: sug.id, wornFitId: sug.fits[0]?.id ?? null });
  }
  return { id: s.id, mode: s.mode, occasionLabel: s.occasion?.name ?? s.occasionText ?? null, date: s.date, boards };
}

export async function latestTogether(viewer: Viewer, date: string): Promise<TogetherView | null> {
  const s = await db.togetherSession.findFirst({ where: { date, OR: [{ createdById: viewer.id }, { people: { some: { personId: viewer.id } } }] }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return s ? getTogether(viewer, s.id) : null;
}

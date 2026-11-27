import { db } from "@/lib/db";
import { isMockAi, structured } from "@/lib/ai/claude";
import { describe, loadCandidates, styleContext, type Candidate, type CandidateSet } from "@/lib/outfits/catalog";
import { inputsFrom, OutfitError, type Board, type DayContext, type Piece } from "@/lib/outfits/engine";
import type { Viewer } from "@/lib/people/visibility";
import type { Step } from "@/lib/jobs";
import type { TogetherMode } from "@/generated/prisma/client";

/**
 * Together mode: one look per person for the same plan, in one Claude call so the looks relate.
 * coordinate = same vibe, complementary colors · match = clearly matching colors/pieces · contrast = deliberately different.
 */

export type TogetherBoard = { personId: string; personName: string; board: Board; pieces: Piece[]; suggestionId: string; wornFitId: string | null };
/** A person who was in the session but got no look, and why: shown as a line, never silently missing (review D 8.2). */
export type TogetherMissing = { personId: string; personName: string; reason: string };
export type TogetherView = { id: string; mode: TogetherMode; occasionId: string | null; occasionLabel: string | null; date: string; boards: TogetherBoard[]; missing: TogetherMissing[] };

const MODE_TEXT: Record<TogetherMode, string> = {
  coordinate: "COORDINATE: the looks share a mood and palette without copying each other.",
  match: "MATCH: the looks visibly match — same colors or twin pieces where the closets allow.",
  contrast: "CONTRAST: the looks are deliberately different in color and formality, and still work side by side.",
};

/** Why a person got no look; kept on their suggestion row so the screen can say it later. */
const SKIPPED = { fewPieces: "Not enough clean pieces for a look.", model: "The stylist left them out this round. Try again." };

/** The people a viewer may put in a Together session: themselves, anyone whose closet they can see (minors only with their parents). */
export async function togetherPeople(viewer: Viewer): Promise<{ id: string; name: string }[]> {
  const people = await db.person.findMany({ where: { status: { not: "removed" } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, role: true, guardians: { select: { parentId: true } } } });
  return people.filter((p) => p.role !== "minor" || p.id === viewer.id || p.guardians.some((g) => g.parentId === viewer.id)).map((p) => ({ id: p.id, name: p.name.split(" ")[0] }));
}

type Per = { id: string; name: string; label: string; cand: CandidateSet; style: string };

/** First names, made unique for the model's answer: two Jeffs become "the owner (1)" and "the owner (2)" (review D 8.3). */
function uniqueLabels(names: string[]): string[] {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((n) => { if ((counts.get(n) ?? 0) < 2) return n; const k = (seen.get(n) ?? 0) + 1; seen.set(n, k); return `${n} (${k})`; });
}

export async function createTogether(viewer: Viewer, opts: { personIds: string[]; mode: TogetherMode; occasionId?: string | null; occasionText?: string | null; date: string; ctx: DayContext; step?: Step }): Promise<TogetherView> {
  const step = opts.step ?? (() => {});
  const allowed = await togetherPeople(viewer);
  const ids = [...new Set(opts.personIds)].filter((id) => allowed.some((a) => a.id === id));
  if (ids.length < 2) throw new OutfitError("Pick at least two people.");
  const occasion = opts.occasionId ? await db.occasion.findFirst({ where: { id: opts.occasionId, isArchived: false } }) : null;
  const label = occasion?.name ?? opts.occasionText?.trim() ?? null;
  const now = opts.ctx.now ?? new Date();
  const names = ids.map((id) => allowed.find((a) => a.id === id)!.name);
  const labels = uniqueLabels(names);
  step(`Reading ${names.length === 2 ? `${names[0]}’s and ${names[1]}’s` : "everyone’s"} closets…`);
  const per: Per[] = await Promise.all(ids.map(async (id, i) => { const [cand, style] = await Promise.all([loadCandidates(id, now), styleContext(id)]); return { id, name: names[i], label: labels[i], cand, style }; }));
  // The plan is the one picked here, else nothing: the creator's own calendar is not everyone's plan (review D 8.4).
  const ctx: DayContext = { ...opts.ctx, plan: label ? { source: "pick", occasionId: occasion?.id ?? null, label } : { source: "none", occasionId: null, label: null } };
  step(opts.mode === "match" ? "Matching the looks…" : "Dressing everyone together…");
  const boards = await composeTogether(per, opts.mode, ctx, now);
  step("Saving…");
  const session = await db.togetherSession.create({ data: { mode: opts.mode, occasionId: occasion?.id, occasionText: occasion ? null : label, createdById: viewer.id, date: opts.date, people: { create: ids.map((personId) => ({ personId })) } } });
  // One write for every person (review D 8.6); a person with no look keeps the reason on their row.
  await db.outfitSuggestion.createMany({ data: per.map((p) => {
    const b = boards.get(p.id);
    const skipped = b ? null : p.cand.usable.length < 2 ? SKIPPED.fewPieces : SKIPPED.model;
    return { personId: p.id, date: opts.date, togetherSessionId: session.id, inputs: { ...inputsFrom(ctx, p.cand), ...(skipped ? { skipped } : {}) } as object, outfits: (b ? [b] : []) as object[] };
  }) });
  return (await getTogether(viewer, session.id))!;
}

async function composeTogether(per: Per[], mode: TogetherMode, ctx: DayContext, now: Date): Promise<Map<string, Board>> {
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
  const dressable = per.filter((p) => p.cand.usable.length >= 2);
  if (!dressable.length) return result;
  const codes = new Map<string, Candidate>();
  const sections = dressable.map((p) => {
    const lines = p.cand.usable.map((c) => { const code = `${p.name[0].toUpperCase()}${codes.size + 1}`; codes.set(code, c); return describe(c, code, now); });
    return `${p.label}'s pieces (codes start with ${p.name[0].toUpperCase()}):\n${p.style ? `Style: ${p.style.replace(/\n/g, "; ")}\n` : ""}${lines.join("\n")}`;
  });
  const inputs = inputsFrom(ctx, { restingIds: [], noRepeatDays: 0 });
  const prompt = [
    `Dress these ${dressable.length} people together. ${MODE_TEXT[mode]}`,
    inputs.weather ? `Weather: ${inputs.weather.nowF}° now → ${inputs.weather.tonightF}° tonight, ${inputs.weather.condition}` : "Weather: unknown",
    inputs.plan.label ? `Plan: ${inputs.plan.label}` : "Plan: everyday",
    ...sections,
    `Return exactly one look per person (${dressable.map((p) => p.label).join(", ")}) using only that person's own codes.`,
  ].join("\n\n");
  const schema = { type: "object", properties: { looks: { type: "array", items: { type: "object", properties: { person: { type: "string", enum: dressable.map((p) => p.label) }, codes: { type: "array", items: { type: "string" }, description: "2 to 6 of this person's codes." }, reason: { type: "string" } }, required: ["person", "codes", "reason"], additionalProperties: false } } }, required: ["looks"], additionalProperties: false };
  const out = await structured<{ looks: { person: string; codes: string[]; reason: string }[] }>({
    system: "You are a personal stylist dressing a family together. Use only the numbered pieces given, each person's own codes only. One short warm reason per person (max 20 words). No emoji.",
    prompt, schema, effort: "medium", maxTokens: 3000, // 3 or 4 people with thinking on: 1500 cut the answer off (review D 8.5)
  });
  for (const look of out.looks) {
    const p = dressable.find((x) => x.label === look.person);
    if (!p || result.has(p.id)) continue;
    const ids = [...new Set(look.codes.map((c) => codes.get(c.trim())).filter((c): c is Candidate => Boolean(c) && p.cand.usable.some((u) => u.id === c!.id)).map((c) => c.id))];
    if (ids.length >= 2) result.set(p.id, { itemIds: ids, reason: look.reason.trim() });
  }
  return result;
}

export async function getTogether(viewer: Viewer, sessionId: string): Promise<TogetherView | null> {
  const s = await db.togetherSession.findUnique({ where: { id: sessionId }, include: { occasion: true, people: { include: { person: { select: { id: true, name: true } } } }, suggestions: { include: { fits: { select: { id: true } } } } } });
  if (!s) return null;
  if (!s.people.some((p) => p.personId === viewer.id) && s.createdById !== viewer.id) return null;
  const rows = s.people.map((p) => ({ p, sug: s.suggestions.find((x) => x.personId === p.personId), board: (s.suggestions.find((x) => x.personId === p.personId)?.outfits as Board[] | undefined)?.[0] }));
  // Every board's pieces in one read (review D 8.6).
  const allIds = [...new Set(rows.flatMap((r) => r.board?.itemIds ?? []))];
  const items = allIds.length ? await db.item.findMany({ where: { id: { in: allIds } }, select: { id: true, name: true, ownerId: true, category: { select: { name: true } }, subcategory: { select: { name: true } }, photos: { where: { kind: "thumb" }, take: 1, select: { bucketKey: true } } } }) : [];
  const boards: TogetherBoard[] = [];
  const missing: TogetherMissing[] = [];
  for (const { p, sug, board } of rows) {
    const personName = p.person.name.split(" ")[0];
    if (!sug || !board) {
      missing.push({ personId: p.personId, personName, reason: (sug?.inputs as { skipped?: string } | null)?.skipped ?? SKIPPED.model });
      continue;
    }
    const pieces = board.itemIds.map((id) => items.find((it) => it.id === id)).filter(Boolean).map((it) => ({ id: it!.id, name: it!.name ?? "Untitled piece", label: (it!.subcategory?.name ?? it!.category?.name ?? "piece").toUpperCase(), thumbKey: it!.photos[0]?.bucketKey ?? null, ownerId: it!.ownerId, category: it!.category?.name ?? null }));
    boards.push({ personId: p.personId, personName, board, pieces, suggestionId: sug.id, wornFitId: sug.fits[0]?.id ?? null });
  }
  return { id: s.id, mode: s.mode, occasionId: s.occasion?.id ?? null, occasionLabel: s.occasion?.name ?? s.occasionText ?? null, date: s.date, boards, missing };
}

export async function latestTogether(viewer: Viewer, date: string): Promise<TogetherView | null> {
  const s = await db.togetherSession.findFirst({ where: { date, OR: [{ createdById: viewer.id }, { people: { some: { personId: viewer.id } } }] }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return s ? getTogether(viewer, s.id) : null;
}

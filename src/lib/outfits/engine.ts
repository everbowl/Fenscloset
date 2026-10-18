import { db } from "@/lib/db";
import { AiError, isMockAi, structured } from "@/lib/ai/claude";
import { getObject } from "@/lib/storage";
import { toAiImage } from "@/lib/images/thumb";
import { describe, loadCandidates, styleContext, type Candidate } from "@/lib/outfits/catalog";
import { weatherLine, type Weather } from "@/lib/weather";
import type { Plan } from "@/lib/plans";
import type { CheckInView } from "@/lib/checkins/service";
import type { Viewer } from "@/lib/people/visibility";
import type { Prisma } from "@/generated/prisma/client";
import { fromDayKey } from "@/lib/dates";

/**
 * Three looks for one person and one day, from their own closet. A text-only pass (tags, not photos; plan A1)
 * drafts a few more looks than needed, then a vision pass looks at the actual cutouts and keeps the best ones
 * (clashing colors or patterns, mismatched formality, or a dull mix get dropped). Boards are stored on
 * OutfitSuggestion.outfits so a reload shows the same three.
 */

export class OutfitError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "OutfitError";
  }
}

export type Piece = { id: string; name: string; label: string; thumbKey: string | null; ownerId: string };
export type Board = { itemIds: string[]; reason: string };
export type BoardView = Board & { pieces: Piece[]; index: number; wornFitId: string | null };

export type Inputs = {
  weather: Weather | null;
  plan: { label: string | null; source: string };
  checkIn: { scale: string; option: string }[];
  restingIds: string[];
  noRepeatDays: number;
};

export type Suggestion = { id: string; date: string; inputs: Inputs; boards: BoardView[]; wornIndex: number | null };

const SYSTEM = `You are a personal stylist for one family's private closet app. You only ever pick from the numbered pieces you are given; never invent pieces.
Build complete, wearable outfits: a top and a bottom (or a dress), shoes, and up to two layers/accessories when they help. 3 to 6 pieces each.
Match the weather and the plan. Use the style profile and check-in (tan, hair, skin) to steer colors and effort. Prefer favorites and pieces not worn in a while; vary the three looks.
Write one short reason per look (max 20 words) in a warm editorial voice, naming the weather or plan when it matters. No emoji.`;

const SCHEMA = {
  type: "object",
  properties: {
    outfits: {
      type: "array", description: "Exactly the number of looks asked for.",
      items: { type: "object", properties: { codes: { type: "array", items: { type: "string" }, description: "2 to 6 piece codes like #3, hero first." }, reason: { type: "string" } }, required: ["codes", "reason"], additionalProperties: false },
    },
  },
  required: ["outfits"], additionalProperties: false,
} as const;

function contextLines(inputs: Inputs): string {
  return [
    inputs.weather ? `Weather: ${weatherLine(inputs.weather)}, ${inputs.weather.condition}, high ${inputs.weather.highF}°, low ${inputs.weather.lowF}°` : "Weather: unknown",
    inputs.plan.label ? `Plan: ${inputs.plan.label}` : "Plan: nothing special (everyday)",
    inputs.checkIn.length ? `Check-in: ${inputs.checkIn.map((c) => `${c.scale} ${c.option}`).join(", ")}` : null,
  ].filter(Boolean).join("\n");
}

/** Deterministic looks for tests/local dev: one piece from each category, rotating by look number. */
function mockLooks(cands: Candidate[], count: number, offset: number): Board[] {
  const byCat = new Map<string, Candidate[]>();
  for (const c of cands) { const k = c.category ?? "?"; byCat.set(k, [...(byCat.get(k) ?? []), c]); }
  const cats = [...byCat.keys()];
  const boards: Board[] = [];
  for (let i = offset; i < offset + count; i++) {
    const ids = cats.map((k) => byCat.get(k)![i % byCat.get(k)!.length].id).slice(0, 5);
    if (ids.length < 2) break;
    boards.push({ itemIds: ids, reason: `Mock look ${i + 1}: easy pieces for the day.` });
  }
  return boards;
}

const DRAFT_EXTRA = 2;

const RANK_SYSTEM = `You are a personal stylist judging outfit candidates by LOOKING at the clothes. For each look you get its pieces' photos, labelled "Look N".
Keep the looks that work best together in real life: colors and patterns that sit well side by side, matching formality, a clear silhouette. Drop a look when two pieces clash, the formality is mixed up, or it is a duller copy of another look.
Return exactly the number asked for, best first, with a fresh one-sentence reason (max 20 words, warm editorial voice, naming the weather or plan when it matters). No emoji.`;

const RANK_SCHEMA = {
  type: "object",
  properties: { keep: { type: "array", description: "Exactly the number of looks asked for, best first.", items: { type: "object", properties: { look: { type: "integer", description: "The look number as labelled." }, reason: { type: "string" } }, required: ["look", "reason"], additionalProperties: false } } },
  required: ["keep"], additionalProperties: false,
} as const;

/**
 * Vision pass: Claude sees the cutout photos of every drafted look and keeps the best `count`.
 * Falls back to the text order when photos are missing or the call fails, so a look always comes back.
 */
export async function rankVisually(boards: Board[], cands: Candidate[], inputs: Inputs, count: number, style: string): Promise<Board[]> {
  if (boards.length <= count) return boards;
  const byId = new Map(cands.map((c) => [c.id, c]));
  const ids = [...new Set(boards.flatMap((b) => b.itemIds))];
  const thumbs = new Map<string, { data: string; mediaType: "image/jpeg" }>();
  await Promise.all(ids.map(async (id) => {
    const key = byId.get(id)?.thumbKey;
    if (!key) return;
    try { thumbs.set(id, await toAiImage((await getObject(key)).body)); } catch { /* no photo: judged by its tags */ }
  }));
  if (thumbs.size < Math.ceil(ids.length / 2)) return boards.slice(0, count);
  const images = boards.flatMap((b, i) => b.itemIds.flatMap((id) => { const t = thumbs.get(id); const c = byId.get(id); return t && c ? [{ label: `Look ${i + 1}: ${c.name} (${[c.category, c.subcategory].filter(Boolean).join("/") || "piece"})`, ...t }] : []; }));
  const prompt = [
    contextLines(inputs),
    style ? `Style profile:\n${style}` : null,
    boards.map((b, i) => `Look ${i + 1}: ${b.itemIds.map((id) => byId.get(id)?.name ?? "?").join(" + ")} — draft reason: ${b.reason}`).join("\n"),
    `Keep the best ${count}.`,
  ].filter(Boolean).join("\n\n");
  try {
    const out = await structured<{ keep: { look: number; reason: string }[] }>({ system: RANK_SYSTEM, prompt, images, schema: RANK_SCHEMA, effort: "medium", maxTokens: 800 });
    const kept: Board[] = [];
    for (const k of out.keep) {
      const b = boards[k.look - 1];
      if (b && !kept.includes(b)) kept.push({ itemIds: b.itemIds, reason: k.reason.trim() || b.reason });
      if (kept.length === count) break;
    }
    for (const b of boards) { if (kept.length >= count) break; if (!kept.some((k) => k.itemIds === b.itemIds)) kept.push(b); }
    return kept.slice(0, count);
  } catch (e) {
    if (e instanceof AiError) { console.error("visual ranking skipped:", e.message); return boards.slice(0, count); }
    throw e;
  }
}

/** Ask Claude for `count` looks from `cands`, skipping any combination already in `exclude`. Drafts a couple extra, then the vision pass keeps the best. */
export async function composeLooks(opts: { cands: Candidate[]; inputs: Inputs; style: string; count: number; excludeBoards?: Board[]; extra?: string; now?: Date; visual?: boolean }): Promise<Board[]> {
  const { cands, inputs, count } = opts;
  if (cands.length < 2) return [];
  const codes = new Map<string, Candidate>();
  cands.forEach((c, i) => codes.set(`#${i + 1}`, c));
  if (isMockAi()) return mockLooks(cands, count, opts.excludeBoards?.length ?? 0);
  const draft = opts.visual === false ? count : count + DRAFT_EXTRA;
  const catalog = [...codes.entries()].map(([code, c]) => describe(c, code, opts.now)).join("\n");
  const shown = (opts.excludeBoards ?? []).map((b) => b.itemIds.map((id) => [...codes.entries()].find(([, c]) => c.id === id)?.[0]).filter(Boolean).join(" + "));
  const prompt = [
    contextLines(inputs),
    opts.style ? `Style profile:\n${opts.style}` : null,
    inputs.restingIds.length ? `Resting (worn in the last ${inputs.noRepeatDays} days, left out of the list): ${inputs.restingIds.length} pieces.` : null,
    opts.extra ?? null,
    shown.length ? `Already shown, do not repeat these combinations: ${shown.join(" | ")}` : null,
    `Pieces:\n${catalog}`,
    `Return ${draft} looks.`,
  ].filter(Boolean).join("\n\n");
  const out = await structured<{ outfits: { codes: string[]; reason: string }[] }>({ system: SYSTEM, prompt, schema: SCHEMA, effort: "medium", maxTokens: 1800 });
  const boards: Board[] = [];
  for (const o of out.outfits) {
    const ids = [...new Set(o.codes.map((code) => codes.get(code.trim())?.id).filter((x): x is string => Boolean(x)))];
    if (ids.length >= 2) boards.push({ itemIds: ids, reason: o.reason.trim() });
  }
  if (opts.visual === false) return boards.slice(0, count);
  return rankVisually(boards.slice(0, draft), cands, inputs, count, opts.style);
}

function toPiece(c: Candidate): Piece {
  return { id: c.id, name: c.name, label: (c.subcategory ?? c.category ?? "piece").toUpperCase(), thumbKey: c.thumbKey, ownerId: c.ownerId };
}

async function piecesFor(boards: Board[]): Promise<Map<string, Piece>> {
  const ids = [...new Set(boards.flatMap((b) => b.itemIds))];
  const items = await db.item.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, ownerId: true, category: { select: { name: true } }, subcategory: { select: { name: true } }, photos: { where: { kind: "thumb" }, take: 1, select: { bucketKey: true } } } });
  return new Map(items.map((it) => [it.id, { id: it.id, name: it.name ?? "Untitled piece", label: (it.subcategory?.name ?? it.category?.name ?? "piece").toUpperCase(), thumbKey: it.photos[0]?.bucketKey ?? null, ownerId: it.ownerId }]));
}

async function view(row: { id: string; date: string; inputs: Prisma.JsonValue; outfits: Prisma.JsonValue }): Promise<Suggestion> {
  const boards = row.outfits as Board[];
  const pieces = await piecesFor(boards);
  const fits = await db.fit.findMany({ where: { outfitSuggestionId: row.id }, select: { id: true, items: { select: { itemId: true } } } });
  const views = boards.map<BoardView>((b, index) => {
    const key = [...b.itemIds].sort().join(",");
    const fit = fits.find((f) => f.items.map((i) => i.itemId).sort().join(",") === key);
    return { ...b, index, pieces: b.itemIds.map((id) => pieces.get(id)).filter((p): p is Piece => Boolean(p)), wornFitId: fit?.id ?? null };
  });
  const wornIndex = views.findIndex((v) => v.wornFitId);
  return { id: row.id, date: row.date, inputs: row.inputs as Inputs, boards: views, wornIndex: wornIndex >= 0 ? wornIndex : null };
}

/** Today's stored suggestion, or null. */
export async function getSuggestion(personId: string, date: string): Promise<Suggestion | null> {
  const row = await db.outfitSuggestion.findFirst({ where: { personId, date, togetherSessionId: null }, orderBy: { createdAt: "desc" } });
  return row ? view(row) : null;
}

export type DayContext = { weather: Weather | null; plan: Plan; checkIn: CheckInView | null; now?: Date };

export function inputsFrom(ctx: DayContext, cand: { restingIds: string[]; noRepeatDays: number }): Inputs {
  return {
    weather: ctx.weather,
    plan: { label: ctx.plan.label, source: ctx.plan.source },
    checkIn: (ctx.checkIn?.answers ?? []).map((a) => ({ scale: a.scaleName, option: a.optionName })),
    restingIds: cand.restingIds, noRepeatDays: cand.noRepeatDays,
  };
}

/** Build (or rebuild) the three looks for a day. */
export async function generateSuggestion(personId: string, date: string, ctx: DayContext): Promise<Suggestion> {
  const now = ctx.now ?? new Date();
  const cand = await loadCandidates(personId, now);
  const inputs = inputsFrom(ctx, cand);
  let boards = await composeLooks({ cands: cand.usable, inputs, style: await styleContext(personId), count: 3, now });
  if (boards.length < 3 && cand.restingIds.length) {
    // Not enough fresh pieces: let resting ones back in and say so in the reason.
    const everything = await loadCandidates(personId, now, { noRepeatDays: 0 });
    const more = await composeLooks({ cands: everything.usable, inputs: { ...inputs, restingIds: [] }, style: await styleContext(personId), count: 3 - boards.length, excludeBoards: boards, extra: "Some pieces were worn recently; it is fine to repeat them today because the closet is small.", now });
    boards = [...boards, ...more.map((b) => ({ ...b, reason: `${b.reason} (Repeats a recent piece: not much else is clean.)` }))];
  }
  const row = await db.outfitSuggestion.create({ data: { personId, date, inputs: inputs as object, outfits: boards as object[] } });
  return view(row);
}

/** Today's looks, generating them on first open. */
export async function getOrGenerate(personId: string, date: string, ctx: DayContext): Promise<Suggestion> {
  return (await getSuggestion(personId, date)) ?? generateSuggestion(personId, date, ctx);
}

/** MORE LOOKS: three new boards that avoid the combinations already shown, appended to the day's suggestion. */
export async function moreLooks(personId: string, date: string, ctx: DayContext): Promise<Suggestion> {
  const row = await db.outfitSuggestion.findFirst({ where: { personId, date, togetherSessionId: null }, orderBy: { createdAt: "desc" } });
  if (!row) return generateSuggestion(personId, date, ctx);
  const now = ctx.now ?? new Date();
  const cand = await loadCandidates(personId, now);
  const shown = row.outfits as Board[];
  const inputs = inputsFrom(ctx, cand);
  const more = await composeLooks({ cands: cand.usable, inputs, style: await styleContext(personId), count: 3, excludeBoards: shown, now });
  if (!more.length) throw new OutfitError("No more combinations in the closet today. Add clothes or do laundry.");
  const updated = await db.outfitSuggestion.update({ where: { id: row.id }, data: { outfits: [...shown, ...more] as object[] } });
  return view(updated);
}

/** SWAP ONE PIECE: replace `itemId` on board `index` with one piece of the same category, with a fresh reason. */
export async function swapPiece(personId: string, date: string, index: number, itemId: string, ctx: DayContext): Promise<Suggestion> {
  const row = await db.outfitSuggestion.findFirst({ where: { personId, date, togetherSessionId: null }, orderBy: { createdAt: "desc" } });
  if (!row) throw new OutfitError("No looks yet today.");
  const boards = row.outfits as Board[];
  const board = boards[index];
  if (!board || !board.itemIds.includes(itemId)) throw new OutfitError("That piece isn't on this look.");
  const now = ctx.now ?? new Date();
  const cand = await loadCandidates(personId, now);
  const current = cand.usable.find((c) => c.id === itemId) ?? (await db.item.findUnique({ where: { id: itemId }, select: { category: { select: { name: true } } } }).then((it) => (it ? { category: it.category?.name ?? null } : null)));
  const sameCat = cand.usable.filter((c) => c.id !== itemId && !board.itemIds.includes(c.id) && c.category === (current?.category ?? null));
  if (!sameCat.length) throw new OutfitError("Nothing else clean in that category today.");
  const keep = board.itemIds.filter((id) => id !== itemId);
  const keepCands = cand.usable.filter((c) => keep.includes(c.id));
  let replacement: Candidate; let reason: string;
  if (isMockAi()) {
    replacement = sameCat[0]; reason = `Mock swap: ${replacement.name} instead.`;
  } else {
    const codes = new Map<string, Candidate>(sameCat.map((c, i) => [`#${i + 1}`, c]));
    const prompt = [
      contextLines(inputsFrom(ctx, cand)),
      `The person keeps: ${keepCands.map((c) => c.name).join(", ") || "nothing yet"}.`,
      `Pick ONE replacement from these pieces (same category as the one they are swapping out) and write a short reason for the whole look:\n${[...codes.entries()].map(([code, c]) => describe(c, code, now)).join("\n")}`,
    ].join("\n\n");
    const out = await structured<{ code: string; reason: string }>({ system: SYSTEM, prompt, schema: { type: "object", properties: { code: { type: "string" }, reason: { type: "string" } }, required: ["code", "reason"], additionalProperties: false }, effort: "low", maxTokens: 300 });
    replacement = codes.get(out.code.trim()) ?? sameCat[0]; reason = out.reason.trim();
  }
  const next = boards.map((b, i) => (i === index ? { itemIds: b.itemIds.map((id) => (id === itemId ? replacement.id : id)), reason } : b));
  const updated = await db.outfitSuggestion.update({ where: { id: row.id }, data: { outfits: next as object[] } });
  return view(updated);
}

/** Who may act (wear/swap) for a person: themselves, or a parent for their minor. */
export async function canDress(viewer: Viewer, personId: string): Promise<boolean> {
  if (viewer.id === personId) return true;
  return Boolean(await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: personId, parentId: viewer.id } } }));
}

export async function assertCanDress(viewer: Viewer, personId: string) {
  if (!(await canDress(viewer, personId))) throw new OutfitError("Only the person (or their parent) can do that.", 403);
}

/**
 * WEAR THIS: log every piece as worn today, bump wear counts, and put the look on the Fits calendar.
 * Returns the fit id. Wearing a second look the same day replaces the first fit (and its wear log).
 */
export async function wearBoard(viewer: Viewer, personId: string, suggestionId: string, index: number, title: string, now = new Date()): Promise<string> {
  await assertCanDress(viewer, personId);
  const row = await db.outfitSuggestion.findFirst({ where: { id: suggestionId, personId } });
  if (!row) throw new OutfitError("No looks yet today.");
  const board = (row.outfits as Board[])[index];
  if (!board) throw new OutfitError("That look isn't here anymore.");
  return wearItems(personId, row.date, board.itemIds, { title, outfitSuggestionId: row.id, now });
}

export async function wearItems(personId: string, date: string, itemIds: string[], opts: { title: string; outfitSuggestionId?: string; now?: Date; fitId?: string }): Promise<string> {
  const now = opts.now ?? new Date();
  const items = await db.item.findMany({ where: { id: { in: itemIds }, retiredAt: null }, select: { id: true } });
  if (!items.length) throw new OutfitError("Those pieces are gone from the closet.");
  const ids = items.map((i) => i.id);
  return db.$transaction(async (tx) => {
    const existing = opts.fitId ? await tx.fit.findUnique({ where: { id: opts.fitId } }) : await tx.fit.findFirst({ where: { personId, date }, orderBy: { createdAt: "asc" } });
    if (existing) {
      // undo the previous log for the day before re-counting
      const old = await tx.wearLog.findMany({ where: { fitId: existing.id } });
      await tx.wearLog.deleteMany({ where: { fitId: existing.id } });
      await tx.fitItem.deleteMany({ where: { fitId: existing.id } });
      for (const w of old) {
        const prev = await tx.wearLog.findFirst({ where: { itemId: w.itemId }, orderBy: { wornOn: "desc" }, select: { wornOn: true } });
        await tx.item.update({ where: { id: w.itemId }, data: { wearCount: { decrement: 1 }, lastWornAt: prev ? fromDayKey(prev.wornOn) : null } });
      }
    }
    const fit = existing
      ? await tx.fit.update({ where: { id: existing.id }, data: { title: opts.title, outfitSuggestionId: opts.outfitSuggestionId ?? existing.outfitSuggestionId, items: { create: ids.map((itemId, sortOrder) => ({ itemId, sortOrder })) } } })
      : await tx.fit.create({ data: { personId, date, title: opts.title, outfitSuggestionId: opts.outfitSuggestionId, items: { create: ids.map((itemId, sortOrder) => ({ itemId, sortOrder })) } } });
    await tx.wearLog.createMany({ data: ids.map((itemId) => ({ personId, itemId, wornOn: date, fitId: fit.id })) });
    for (const id of ids) {
      const last = await tx.wearLog.findFirst({ where: { itemId: id }, orderBy: { wornOn: "desc" }, select: { wornOn: true } });
      await tx.item.update({ where: { id }, data: { wearCount: { increment: 1 }, lastWornAt: last && last.wornOn > date ? undefined : now } });
    }
    return fit.id;
  });
}

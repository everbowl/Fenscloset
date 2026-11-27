import { db } from "@/lib/db";
import { AiError, isMockAi, structured } from "@/lib/ai/claude";
import { getObject } from "@/lib/storage";
import { toAiImage } from "@/lib/images/thumb";
import { describe, loadCandidates, styleContext, type Candidate, type CandidateSet } from "@/lib/outfits/catalog";
import { weatherLine, type Weather } from "@/lib/weather";
import type { Plan } from "@/lib/plans";
import type { CheckInView } from "@/lib/checkins/service";
import type { Viewer } from "@/lib/people/visibility";
import type { Prisma } from "@/generated/prisma/client";
import { dayKey, hourIn, isEvening, wornDateToInstant } from "@/lib/dates";
import { getTimezone } from "@/lib/rules";
import type { Step } from "@/lib/jobs";
import { recordPassed, recordSwap, recordWorn } from "@/lib/outfits/taste";

/**
 * Three looks for one person and one day, from their own closet. The first look is drafted alone from the tags (a
 * quick text pass) and saved at once, so the screen has a board in about ten seconds; two more are then drafted with a
 * couple of spares and a vision pass looks at the actual cutouts and keeps the best (clashing colors or patterns,
 * mismatched formality, or a dull mix get dropped). Boards are stored on OutfitSuggestion.outfits so a reload shows
 * the same three (review D §0: the old build ran two medium-effort calls and saved nothing for 20 to 40 seconds).
 */

export class OutfitError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "OutfitError";
  }
}

export type Piece = { id: string; name: string; label: string; thumbKey: string | null; ownerId: string; /** Category name, so the board can stack top over bottom over shoes. */ category?: string | null };
/** Why a look works, in plain lines the Today screen lists under the one-sentence reason. */
type Why = { weather: string[]; dressCode: string; color: string; taste: string };
export type Board = { itemIds: string[]; reason: string; why?: Why };
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
Match the weather and the plan. Use the style profile and check-in (tan, hair, skin) to steer colors and effort. Prefer favorites and pieces not worn in a while; vary the looks.
For each look write:
- reason: ONE plain sentence (max 18 words) saying what the look is and why it suits today. Plain prose, no flourish, no emoji.
- why.weather: 2 or 3 short lines that quote the numbers (now, tonight, high, low, rain chance) and say what they rule in or out: sleeves, layers, fabric weight, shoes.
- why.dressCode: one line on the plan or setting and how dressed-up the look is.
- why.color: one line on why these colors work together.
- why.taste: one line tying the look to the person's style profile, taste memory or check-in; empty string if nothing applies.`;

const WHY_SCHEMA = {
  type: "object",
  properties: {
    weather: { type: "array", items: { type: "string" }, description: "2 or 3 short lines with the numbers and what they rule in or out." },
    dressCode: { type: "string" },
    color: { type: "string" },
    taste: { type: "string", description: "Empty string when nothing applies." },
  },
  required: ["weather", "dressCode", "color", "taste"], additionalProperties: false,
} as const;

function cleanWhy(w: Partial<Why> | undefined): Why {
  return {
    weather: (w?.weather ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 3),
    dressCode: String(w?.dressCode ?? "").trim(), color: String(w?.color ?? "").trim(), taste: String(w?.taste ?? "").trim(),
  };
}

const SCHEMA = {
  type: "object",
  properties: {
    outfits: {
      type: "array", description: "Exactly the number of looks asked for.",
      items: { type: "object", properties: { codes: { type: "array", items: { type: "string" }, description: "2 to 6 piece codes like #3, hero first." }, reason: { type: "string" }, why: WHY_SCHEMA }, required: ["codes", "reason", "why"], additionalProperties: false },
    },
  },
  required: ["outfits"], additionalProperties: false,
} as const;

/** Thinking counts toward max_tokens and a cut-off answer is cut-off JSON (review D 1.2): room for the thinking and the whole answer. */
const TOKENS = { draft: 4500, rank: 1500, swap: 1200, remove: 1200 };

function contextLines(inputs: Inputs): string {
  const w = inputs.weather;
  return [
    w
      ? `Weather: ${weatherLine(w)}, ${w.condition}, now ${w.nowF}°, tonight ${w.tonightF}°, high ${w.highF}°, low ${w.lowF}°, rain chance ${w.rainChance}%${w.stale ? " (an older forecast standing in; the weather service was down)" : ""}`
      : "Weather: unknown (no zip or location yet, or the service was down)",
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
    boards.push({ itemIds: ids, reason: `Mock look ${i + 1}: easy pieces for the day.`, why: mockWhy() });
  }
  return boards;
}

function mockWhy(): Why {
  return { weather: ["Mock weather: 72° now, 60° tonight, no rain.", "Short sleeves now, a layer for the evening."], dressCode: "Everyday, nothing special.", color: "Neutrals that sit easily together.", taste: "" };
}

const DRAFT_EXTRA = 2;

const RANK_SYSTEM = `You are a personal stylist judging outfit candidates by LOOKING at the clothes. Each piece's photo is shown once, labelled with the look numbers it belongs to.
Keep the looks that work best together in real life: colors and patterns that sit well side by side, matching formality, a clear silhouette. Drop a look when two pieces clash, the formality is mixed up, or it is a duller copy of another look.
Return exactly the number asked for, best first, each with a fresh reason: ONE plain sentence (max 18 words) saying what the look is and why it suits today. Plain prose, no flourish, no emoji.`;

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
  // Each photo once, labelled with every look it is in (review D 2.1: a piece in three looks was sent three times).
  const images = ids.flatMap((id) => {
    const t = thumbs.get(id); const c = byId.get(id);
    if (!t || !c) return [];
    const looks = boards.flatMap((b, i) => (b.itemIds.includes(id) ? [i + 1] : []));
    return [{ label: `${c.name} (${[c.category, c.subcategory].filter(Boolean).join("/") || "piece"}) — in ${looks.length === 1 ? "Look" : "Looks"} ${looks.join(", ")}`, ...t }];
  });
  const prompt = [
    contextLines(inputs),
    style ? `Style profile:\n${style}` : null,
    boards.map((b, i) => `Look ${i + 1}: ${b.itemIds.map((id) => byId.get(id)?.name ?? "?").join(" + ")} — draft reason: ${b.reason}`).join("\n"),
    `Keep the best ${count}.`,
  ].filter(Boolean).join("\n\n");
  try {
    const out = await structured<{ keep: { look: number; reason: string }[] }>({ system: RANK_SYSTEM, prompt, images, schema: RANK_SCHEMA, effort: "medium", maxTokens: TOKENS.rank });
    const kept: Board[] = [];
    for (const k of out.keep) {
      const b = boards[k.look - 1];
      if (b && !kept.includes(b)) kept.push({ itemIds: b.itemIds, reason: k.reason.trim() || b.reason, why: b.why });
      if (kept.length === count) break;
    }
    for (const b of boards) { if (kept.length >= count) break; if (!kept.some((k) => k.itemIds === b.itemIds)) kept.push(b); }
    return kept.slice(0, count);
  } catch (e) {
    if (e instanceof AiError) { console.error("visual ranking skipped:", e.message); return boards.slice(0, count); }
    throw e;
  }
}

/**
 * Ask Claude for `count` looks from `cands`, skipping any combination already in `exclude`. With `visual` (the default)
 * it drafts a couple extra and the vision pass keeps the best; `visual: false` is the quick text-only pass.
 */
export async function composeLooks(opts: { cands: Candidate[]; inputs: Inputs; style: string; count: number; excludeBoards?: Board[]; extra?: string; now?: Date; visual?: boolean; effort?: "low" | "medium" | "high" }): Promise<Board[]> {
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
    `Return ${draft} ${draft === 1 ? "look" : "looks"}.`,
  ].filter(Boolean).join("\n\n");
  const out = await structured<{ outfits: { codes: string[]; reason: string; why?: Partial<Why> }[] }>({ system: SYSTEM, prompt, schema: SCHEMA, effort: opts.effort ?? "low", maxTokens: TOKENS.draft });
  const boards: Board[] = [];
  for (const o of out.outfits) {
    const ids = [...new Set(o.codes.map((code) => codes.get(code.trim())?.id).filter((x): x is string => Boolean(x)))];
    if (ids.length >= 2) boards.push({ itemIds: ids, reason: o.reason.trim(), why: cleanWhy(o.why) });
  }
  if (opts.visual === false) return boards.slice(0, count);
  return rankVisually(boards.slice(0, draft), cands, inputs, count, opts.style);
}

async function piecesFor(boards: Board[]): Promise<Map<string, Piece>> {
  const ids = [...new Set(boards.flatMap((b) => b.itemIds))];
  const items = await db.item.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, ownerId: true, category: { select: { name: true } }, subcategory: { select: { name: true } }, photos: { where: { kind: "thumb" }, take: 1, select: { bucketKey: true } } } });
  return new Map(items.map((it) => [it.id, { id: it.id, name: it.name ?? "Untitled piece", label: (it.subcategory?.name ?? it.category?.name ?? "piece").toUpperCase(), thumbKey: it.photos[0]?.bucketKey ?? null, ownerId: it.ownerId, category: it.category?.name ?? null }]));
}

async function view(row: { id: string; personId: string; date: string; inputs: Prisma.JsonValue; outfits: Prisma.JsonValue }): Promise<Suggestion> {
  const boards = row.outfits as Board[];
  // The day's fit, whichever build it came from: a rebuild after a check-in used to lose "Wearing this" (review D 2.2).
  const [pieces, fits] = await Promise.all([piecesFor(boards), db.fit.findMany({ where: { personId: row.personId, date: row.date }, select: { id: true, items: { select: { itemId: true } } } })]);
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

/** The step the screen reads as "board 1 is saved, show it" (the job carries it as `partial`). */
export const FIRST_LOOK_READY = "First look ready";

/** How many looks a day gets. */
const LOOKS = 3;

/**
 * Build (or rebuild) the day's looks. `step` reports where it is to the job (src/lib/jobs.ts). The first look is drafted
 * alone, text only, and saved right away (`partial`), then two more are drafted and judged by their photos, and the row
 * is updated. A small closet lets resting pieces back in and says so in the reason.
 */
export async function generateSuggestion(personId: string, date: string, ctx: DayContext, step: Step = () => {}): Promise<Suggestion> {
  const now = ctx.now ?? new Date();
  step("Reading the closet…");
  const [cand, style] = await Promise.all([loadCandidates(personId, now), styleContext(personId)]);
  const inputs = inputsFrom(ctx, cand);
  const everything = (c: CandidateSet) => [...c.usable, ...c.resting];
  const REPEATS = "Some pieces were worn recently; it is fine to repeat them today because the closet is small.";
  const sayRepeats = (b: Board): Board => ({ ...b, reason: `${b.reason} (Repeats a recent piece: not much else is clean.)` });

  step("Drafting the first look…");
  let boards = await composeLooks({ cands: cand.usable, inputs, style, count: 1, visual: false, effort: "low", now });
  if (!boards.length && cand.resting.length) {
    // Not enough fresh pieces for even one look: let resting ones back in (one load serves both tries; review D 2.6).
    boards = (await composeLooks({ cands: everything(cand), inputs: { ...inputs, restingIds: [] }, style, count: 1, visual: false, effort: "low", extra: REPEATS, now })).map(sayRepeats);
  }
  const row = await db.outfitSuggestion.create({ data: { personId, date, inputs: inputs as object, outfits: boards as object[] } });
  if (boards.length) step(FIRST_LOOK_READY, { partial: true });

  step("Two more looks…");
  const first = boards;
  let more = first.length ? await composeLooks({ cands: cand.usable, inputs, style, count: LOOKS - first.length, excludeBoards: first, now }) : [];
  if (first.length + more.length < LOOKS && cand.resting.length) {
    const filler = await composeLooks({ cands: everything(cand), inputs: { ...inputs, restingIds: [] }, style, count: LOOKS - first.length - more.length, excludeBoards: [...first, ...more], extra: REPEATS, now });
    more = [...more, ...filler.map(sayRepeats)];
  }
  // Build on the row as it stands now: the screen showed the first look while these built, and a swap on it must stay.
  const current = await db.outfitSuggestion.findUnique({ where: { id: row.id }, select: { outfits: true } });
  const kept = (current?.outfits as Board[] | null) ?? first;
  const updated = await db.outfitSuggestion.update({ where: { id: row.id }, data: { outfits: [...kept, ...more] as object[] } });
  return view(updated);
}

/** Today's looks, generating them on first open. */
export async function getOrGenerate(personId: string, date: string, ctx: DayContext): Promise<Suggestion> {
  return (await getSuggestion(personId, date)) ?? generateSuggestion(personId, date, ctx);
}

/** MORE LOOKS: three new boards that avoid the combinations already shown, appended to the day's suggestion. */
export async function moreLooks(personId: string, date: string, ctx: DayContext, step: Step = () => {}): Promise<Suggestion> {
  const row = await db.outfitSuggestion.findFirst({ where: { personId, date, togetherSessionId: null }, orderBy: { createdAt: "desc" } });
  if (!row) return generateSuggestion(personId, date, ctx, step);
  const now = ctx.now ?? new Date();
  step("Reading the closet…");
  const [cand, style] = await Promise.all([loadCandidates(personId, now), styleContext(personId)]);
  const shown = row.outfits as Board[];
  const inputs = inputsFrom(ctx, cand);
  step("Finding three more looks…");
  const more = await composeLooks({ cands: cand.usable, inputs, style, count: 3, excludeBoards: shown, now });
  if (!more.length) throw new OutfitError("No more combinations in the closet today. Add clothes or do laundry.");
  const updated = await db.outfitSuggestion.update({ where: { id: row.id }, data: { outfits: [...shown, ...more] as object[] } });
  // Only now are the shown looks "passed": taste memory must not learn from a build that failed (review D 2.7).
  await recordPassed(personId, date, shown);
  return view(updated);
}

/** A swap or a removal needs no fresh weather: the look's own inputs (what it was built against) carry the day. */
type DayHint = { now?: Date };
function inputsForEdit(row: { inputs: Prisma.JsonValue }, ctx: DayContext | DayHint, cand: CandidateSet): Inputs {
  const stored = row.inputs as Partial<Inputs> | null;
  if (stored && typeof stored === "object" && stored.plan && Array.isArray(stored.checkIn)) {
    return { weather: stored.weather ?? null, plan: stored.plan, checkIn: stored.checkIn, restingIds: cand.restingIds, noRepeatDays: cand.noRepeatDays };
  }
  return inputsFrom("plan" in ctx ? ctx : { weather: null, plan: { source: "none", occasionId: null, label: null }, checkIn: null }, cand);
}

/** SWAP ONE PIECE: replace `itemId` on board `index` with one piece of the same category, with a fresh reason. */
export async function swapPiece(personId: string, date: string, index: number, itemId: string, ctx: DayContext | DayHint): Promise<Suggestion> {
  const row = await db.outfitSuggestion.findFirst({ where: { personId, date, togetherSessionId: null }, orderBy: { createdAt: "desc" } });
  if (!row) throw new OutfitError("No looks yet today.");
  const boards = row.outfits as Board[];
  const board = boards[index];
  if (!board || !board.itemIds.includes(itemId)) throw new OutfitError("That piece isn't on this look.");
  const now = ctx.now ?? new Date();
  const cand = await loadCandidates(personId, now);
  const current = cand.usable.find((c) => c.id === itemId) ?? (await db.item.findUnique({ where: { id: itemId }, select: { category: { select: { name: true } } } }).then((it) => (it ? { category: it.category?.name ?? null } : null)));
  const cat = current?.category ?? null;
  const sameCat = cand.usable.filter((c) => c.id !== itemId && !board.itemIds.includes(c.id) && c.category === cat);
  if (!sameCat.length) {
    // Say why (review D 2.9): the others may be clean but resting.
    const resting = cand.resting.filter((c) => c.id !== itemId && c.category === cat).length;
    throw new OutfitError(resting ? `The other ${resting === 1 ? "piece" : "pieces"} in that category ${resting === 1 ? "is" : "are"} resting (worn in the last ${cand.noRepeatDays} days).` : "Nothing else clean in that category today.");
  }
  const keep = board.itemIds.filter((id) => id !== itemId);
  const keepCands = cand.usable.filter((c) => keep.includes(c.id));
  let replacement: Candidate; let reason: string; let why: Why = board.why ?? mockWhy();
  if (isMockAi()) {
    replacement = sameCat[0]; reason = `Mock swap: ${replacement.name} instead.`;
  } else {
    const codes = new Map<string, Candidate>(sameCat.map((c, i) => [`#${i + 1}`, c]));
    const prompt = [
      contextLines(inputsForEdit(row, ctx, cand)),
      `The person keeps: ${keepCands.map((c) => c.name).join(", ") || "nothing yet"}.`,
      `Pick ONE replacement from these pieces (same category as the one they are swapping out) and write a short reason for the whole look:\n${[...codes.entries()].map(([code, c]) => describe(c, code, now)).join("\n")}`,
    ].join("\n\n");
    const out = await structured<{ code: string; reason: string; why?: Partial<Why> }>({ system: SYSTEM, prompt, schema: { type: "object", properties: { code: { type: "string" }, reason: { type: "string" }, why: WHY_SCHEMA }, required: ["code", "reason", "why"], additionalProperties: false }, effort: "low", maxTokens: TOKENS.swap });
    replacement = codes.get(out.code.trim()) ?? sameCat[0]; reason = out.reason.trim(); why = cleanWhy(out.why);
  }
  await recordSwap(personId, date, itemId, replacement.id, board.itemIds);
  // The row as it is now (the day's other looks may have landed while Claude thought), with this one look changed.
  const latest = await currentBoards(row.id, boards);
  const next = latest.map((b, i) => (i === index && b.itemIds.includes(itemId) ? { itemIds: b.itemIds.map((id) => (id === itemId ? replacement.id : id)), reason, why } : b));
  const updated = await db.outfitSuggestion.update({ where: { id: row.id }, data: { outfits: next as object[] } });
  return view(updated);
}

/** The boards on the row right now, so an edit never writes back a stale list over looks that landed meanwhile. */
async function currentBoards(rowId: string, fallback: Board[]): Promise<Board[]> {
  const fresh = await db.outfitSuggestion.findUnique({ where: { id: rowId }, select: { outfits: true } });
  return (fresh?.outfits as Board[] | null) ?? fallback;
}

/** REMOVE a piece from board `index` (a look keeps at least two pieces). The reason is rewritten for what is left. */
export async function removePiece(personId: string, date: string, index: number, itemId: string, ctx: DayContext | DayHint): Promise<Suggestion> {
  const row = await db.outfitSuggestion.findFirst({ where: { personId, date, togetherSessionId: null }, orderBy: { createdAt: "desc" } });
  if (!row) throw new OutfitError("No looks yet today.");
  const boards = row.outfits as Board[];
  const board = boards[index];
  if (!board || !board.itemIds.includes(itemId)) throw new OutfitError("That piece isn't on this look.");
  if (board.itemIds.length <= 2) throw new OutfitError("A look needs at least two pieces. Swap it instead.");
  const keep = board.itemIds.filter((id) => id !== itemId);
  const now = ctx.now ?? new Date();
  const cand = await loadCandidates(personId, now, { noRepeatDays: 0 });
  const keepCands = cand.usable.filter((c) => keep.includes(c.id));
  const gone = cand.usable.find((c) => c.id === itemId);
  let reason: string; let why: Why = board.why ?? mockWhy();
  if (isMockAi()) {
    reason = `Mock: without ${gone?.name ?? "that piece"}.`;
  } else {
    const prompt = [
      contextLines(inputsForEdit(row, ctx, cand)),
      `The person took ${gone?.name ?? "a piece"} off this look on purpose. The look is now: ${keepCands.map((c, i) => describe(c, `#${i + 1}`, now)).join("; ")}.`,
      "Write the reason and why for the look as it is now. Do not suggest adding anything back.",
    ].join("\n\n");
    const out = await structured<{ reason: string; why?: Partial<Why> }>({ system: SYSTEM, prompt, schema: { type: "object", properties: { reason: { type: "string" }, why: WHY_SCHEMA }, required: ["reason", "why"], additionalProperties: false }, effort: "low", maxTokens: TOKENS.remove });
    reason = out.reason.trim() || board.reason; why = cleanWhy(out.why);
  }
  await recordSwap(personId, date, itemId, null, board.itemIds);
  const latest = await currentBoards(row.id, boards);
  const next = latest.map((b, i) => (i === index && b.itemIds.includes(itemId) ? { itemIds: b.itemIds.filter((id) => id !== itemId), reason, why } : b));
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
 * Returns the fit id. Wearing a second look the same day replaces the first fit (and its wear log). With no `title`,
 * the look's own plan names the fit, else the time of day does.
 */
export async function wearBoard(viewer: Viewer, personId: string, suggestionId: string, index: number, title: string | null, now = new Date()): Promise<string> {
  await assertCanDress(viewer, personId);
  const [row, tz] = await Promise.all([db.outfitSuggestion.findFirst({ where: { id: suggestionId, personId } }), getTimezone()]);
  if (!row) throw new OutfitError("No looks yet today.");
  // A Today left open past midnight still shows yesterday's boards (review D 2.8): the screen refreshes on this error.
  if (row.date !== dayKey(now, tz)) throw new OutfitError("Those looks are from another day. Here are today’s.");
  const boards = row.outfits as Board[];
  const board = boards[index];
  if (!board) throw new OutfitError("That look isn't here anymore.");
  const name = title ?? (row.inputs as Partial<Inputs> | null)?.plan?.label ?? (isEvening(hourIn(now, tz)) ? "Tonight’s look" : "Today’s look");
  await recordPassed(personId, row.date, boards.filter((_, i) => i !== index));
  return wearItems(personId, row.date, board.itemIds, { title: name, outfitSuggestionId: row.id, now });
}

type Tx = Prisma.TransactionClient;

/**
 * Set `lastWornAt` on `itemIds` from their wear logs: the latest `wornOn` as local noon in the household zone (or `now`
 * when that day is today), null when a piece has no wears left. One query for the latest days, one update per distinct
 * day (review D 2.3/2.4/2.5: the old loop wrote UTC midnight, or `now` for a past day, two round trips per piece).
 */
export async function relastWorn(tx: Tx, itemIds: string[], now: Date, tz: string): Promise<void> {
  const ids = [...new Set(itemIds)];
  if (!ids.length) return;
  const latest = await tx.wearLog.groupBy({ by: ["itemId"], where: { itemId: { in: ids } }, _max: { wornOn: true } });
  const dayOf = new Map(latest.map((l) => [l.itemId, l._max.wornOn]));
  const today = dayKey(now, tz);
  const byDay = new Map<string | null, string[]>();
  for (const id of ids) { const d = dayOf.get(id) ?? null; byDay.set(d, [...(byDay.get(d) ?? []), id]); }
  for (const [day, group] of byDay) {
    await tx.item.updateMany({ where: { id: { in: group } }, data: { lastWornAt: day === null ? null : day === today ? now : wornDateToInstant(day, tz) } });
  }
}

export async function wearItems(personId: string, date: string, itemIds: string[], opts: { title: string; outfitSuggestionId?: string; now?: Date; fitId?: string }): Promise<string> {
  const now = opts.now ?? new Date();
  const [items, tz] = await Promise.all([db.item.findMany({ where: { id: { in: itemIds }, retiredAt: null }, select: { id: true } }), getTimezone()]);
  if (!items.length) throw new OutfitError("Those pieces are gone from the closet.");
  const ids = items.map((i) => i.id);
  await recordWorn(personId, date, ids);
  // Batched (review D 2.5): a five-piece look used to be ~20 round trips inside Prisma's 5 s transaction window.
  return db.$transaction(async (tx) => {
    const existing = opts.fitId ? await tx.fit.findUnique({ where: { id: opts.fitId } }) : await tx.fit.findFirst({ where: { personId, date }, orderBy: { createdAt: "asc" } });
    const touched = new Set(ids);
    if (existing) {
      // undo the previous log for the day before re-counting
      const old = await tx.wearLog.findMany({ where: { fitId: existing.id }, select: { itemId: true } });
      const oldIds = [...new Set(old.map((w) => w.itemId))];
      await tx.wearLog.deleteMany({ where: { fitId: existing.id } });
      await tx.fitItem.deleteMany({ where: { fitId: existing.id } });
      if (oldIds.length) await tx.item.updateMany({ where: { id: { in: oldIds } }, data: { wearCount: { decrement: 1 } } });
      oldIds.forEach((id) => touched.add(id));
    }
    const fit = existing
      ? await tx.fit.update({ where: { id: existing.id }, data: { title: opts.title, outfitSuggestionId: opts.outfitSuggestionId ?? existing.outfitSuggestionId, items: { create: ids.map((itemId, sortOrder) => ({ itemId, sortOrder })) } } })
      : await tx.fit.create({ data: { personId, date, title: opts.title, outfitSuggestionId: opts.outfitSuggestionId, items: { create: ids.map((itemId, sortOrder) => ({ itemId, sortOrder })) } } });
    await tx.wearLog.createMany({ data: ids.map((itemId) => ({ personId, itemId, wornOn: date, fitId: fit.id })) });
    await tx.item.updateMany({ where: { id: { in: ids } }, data: { wearCount: { increment: 1 } } });
    await relastWorn(tx, [...touched], now, tz);
    return fit.id;
  }, { timeout: 15_000 });
}

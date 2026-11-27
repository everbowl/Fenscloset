/**
 * Who dresses a look on a body photo (client-safe half; the rule is read in src/lib/tryon/index.ts mirrorEngines).
 * Chosen under Admin → Rules, "Mirror engine": Google, FASHN, Kling, or Compare (the engines switched on under the
 * rule, each with a key, side by side, so the winner can be picked by setting the rule). The mannequin is Google's
 * image model whichever is chosen.
 */
export type Engine = "google" | "fashn" | "kling";
export type EngineRule = Engine | "compare";
const ENGINES: Engine[] = ["google", "fashn", "kling"];
export const ENGINE_RULE_KEY = "mirrorEngine";
/** The on/off switch per engine for Compare (Admin → Rules → Mirror), and what each starts as: Kling off until its balance is topped up (the owner, 26 Nov 2026, 1B). */
export const COMPARE_KEYS: Record<Engine, string> = { google: "compareGoogle", fashn: "compareFashn", kling: "compareKling" };
export const COMPARE_DEFAULTS: Record<Engine, boolean> = { google: true, fashn: true, kling: false };
export const ENGINE_WORD: Record<Engine, string> = { google: "Google", fashn: "FASHN", kling: "Kling" };
const ENGINE_KEYS: Record<Engine, string> = { google: "Google service account", fashn: "FASHN_API_KEY", kling: "KLING_API_KEY" };

export function engineRuleOf(value: string | null | undefined): EngineRule {
  return value === "fashn" || value === "kling" || value === "compare" ? value : "google";
}

/** Only Google's try-on (and the mannequin's image model) can put shoes in the picture. */
export function enginePlacesShoes(engine: Engine): boolean {
  return engine === "google";
}

/**
 * The engines a dressing runs: the rule's engine, or, for Compare, every engine switched on (`include`, the three
 * on/off rules; all on when not given). An engine without its key is left out and said so in the note, and whichever
 * engine does have a key stands in when the chosen one is missing. An engine switched off is simply not wanted: no note.
 */
export function resolveEngines(rule: EngineRule, have: Record<Engine, boolean>, include?: Record<Engine, boolean>): { engines: Engine[]; note?: string } {
  const on = include ?? { google: true, fashn: true, kling: true };
  const wanted: Engine[] = rule === "compare" ? ENGINES.filter((e) => on[e]) : [rule];
  let engines = wanted.filter((e) => have[e]);
  const missing = wanted.filter((e) => !have[e]);
  if (!engines.length) engines = ENGINES.filter((e) => have[e]).slice(0, 1);
  if (!missing.length) return { engines };
  const keys = missing.map((e) => ENGINE_KEYS[e]).join(" or ");
  // One chosen engine without its key: whoever stood in is named. In Compare the others simply ran.
  const stood = rule !== "compare" && engines.length ? ` ${ENGINE_WORD[engines[0]]} dressed this one.` : "";
  return { engines, note: `${missing.map((e) => ENGINE_WORD[e]).join(" and ")} ${missing.length > 1 ? "aren’t" : "isn’t"} set up yet: no ${keys} in Railway.${stood}` };
}

/**
 * Client-safe half of the mirror styling (no database): the feature vocabulary, the pure resolver and the
 * artist's briefs. src/lib/tryon/styling.ts adds the loaders.
 *
 * How a look is styled in the mirror (Jeff, 19 Oct 2026: "don't default to tucking it in; give me
 * options on pose and how the clothes will show; if it's a button-up, how many open, etc.").
 *
 * The try-on model dresses the body however it likes (it tucks). A second pass, Gemini image, applies
 * the person's choices on top: a pose from the Mirror poses list and one option from each "How clothes
 * show" group that applies to the look. Every list is editable under Admin → Lists; the first entry of
 * each list is the default, so "Untucked" sits first in Tuck. A group applies when the look has what
 * its `needs` names (item features, below). The person's last choices live in Person.mirrorPrefs.
 */

/** How a piece is made. The tagger fills these in; the person can correct them on the item. Category adds top / bottom / outer. */
export const FEATURE_KEYS = ["button_front", "zip_front", "long_sleeve", "hood", "collar"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export const FEATURE_LABELS: Record<FeatureKey, string> = { button_front: "Buttons down the front", zip_front: "Zip front", long_sleeve: "Long sleeves", hood: "Hood", collar: "Collar" };
export function isFeatureKey(x: string): x is FeatureKey { return (FEATURE_KEYS as readonly string[]).includes(x); }

export type StylingLists = {
  poses: { id: string; name: string; prompt: string }[];
  groups: { id: string; name: string; needs: string[]; options: { id: string; name: string; prompt: string }[] }[];
};

/** What the person picked: a pose and one option per group (ids). Missing entries fall back to the defaults. */
export type StylingChoice = { poseId?: string | null; options?: Record<string, string> };

/** The choice as resolved for one look, plus what it means. */
export type Styling = {
  poseId: string | null;
  options: Record<string, string>;
  /** Canonical form for caching (null when nothing is chosen that could apply). */
  key: string | null;
  /** The prompt lines for the artist: blank prompts (nothing to change) are left out. */
  instructions: string[];
  /** Labels for the caption, e.g. "Untucked · Top one open · Hands in pockets". */
  summary: string;
  /** The groups that apply to this look, in list order, with the chosen option id. */
  groups: { id: string; name: string; chosen: string; options: { id: string; name: string }[] }[];
};

/** Which kinds of pieces count as a top, a bottom, or an outer layer when a group's `needs` asks for one. */
const TOP_CATEGORIES = new Set(["Tops", "Activewear", "Dresses", "Swimwear", "Sleepwear"]);
const BOTTOM_CATEGORIES = new Set(["Bottoms"]);
const OUTER_CATEGORIES = new Set(["Outerwear"]);

/** A guess from the type name for pieces tagged before features existed; the stored features win when there are any. */
const BY_TYPE: [RegExp, FeatureKey[]][] = [
  [/button|blouse|oxford|flannel|polo/i, ["button_front", "collar"]],
  [/hoodie/i, ["hood", "long_sleeve"]],
  [/sweater|sweatshirt|cardigan|blazer|coat|jacket|puffer/i, ["long_sleeve"]],
  [/cardigan/i, ["button_front"]],
  [/puffer|windbreaker|track/i, ["zip_front"]],
  [/blazer|coat|denim jacket|leather jacket|trench/i, ["button_front", "collar"]],
];

/** The features of one piece: stored ones, else a guess from its type, plus top / bottom / outer from its category. */
export function featuresOf(piece: { features?: string[] | null; category?: string | null; subcategory?: string | null }): Set<string> {
  const out = new Set<string>();
  const stored = (piece.features ?? []).filter(isFeatureKey);
  if (stored.length) for (const f of stored) out.add(f);
  else {
    const type = `${piece.subcategory ?? ""} ${piece.category ?? ""}`;
    for (const [re, keys] of BY_TYPE) if (re.test(type)) for (const k of keys) out.add(k);
  }
  if (piece.category && TOP_CATEGORIES.has(piece.category)) out.add("top");
  if (piece.category && BOTTOM_CATEGORIES.has(piece.category)) out.add("bottom");
  if (piece.category && OUTER_CATEGORIES.has(piece.category)) { out.add("outer"); out.add("top"); }
  return out;
}

/**
 * Pure: the styling for one look from the lists, the person's remembered choices, this call's picks and
 * the look's features. Picks win over remembered choices, which win over the first entry of each list.
 */
export function resolveStyling(lists: StylingLists, remembered: StylingChoice, pick: StylingChoice | undefined, features: Iterable<string>): Styling {
  const have = new Set(features);
  const groups = lists.groups.filter((g) => g.options.length && g.needs.every((n) => have.has(n)));
  const options: Record<string, string> = {};
  const chosenGroups: Styling["groups"] = [];
  const instructions: string[] = [];
  const labels: string[] = [];
  for (const g of groups) {
    const want = pick?.options?.[g.id] ?? remembered.options?.[g.id];
    const opt = g.options.find((o) => o.id === want) ?? g.options[0];
    options[g.id] = opt.id;
    chosenGroups.push({ id: g.id, name: g.name, chosen: opt.id, options: g.options.map((o) => ({ id: o.id, name: o.name })) });
    if (opt.prompt.trim()) instructions.push(opt.prompt.trim());
    labels.push(opt.name);
  }
  const wantPose = pick?.poseId !== undefined ? pick.poseId : remembered.poseId;
  const pose = lists.poses.find((p) => p.id === wantPose) ?? lists.poses[0] ?? null;
  if (pose?.prompt.trim()) { instructions.push(pose.prompt.trim()); labels.push(pose.name); }
  const key = groups.length || pose ? [`pose=${pose?.id ?? ""}`, ...Object.entries(options).sort(([a], [b]) => a.localeCompare(b)).map(([g, o]) => `${g}=${o}`)].join(";") : null;
  return { poseId: pose?.id ?? null, options, key, instructions, summary: labels.join(" · "), groups: chosenGroups };
}

/** The artist's brief for the styling pass over a dressed person. Only the listed changes; the person and the clothes stay. */
export function stylingPrompt(instructions: string[]): string {
  return `This is a photo of a person wearing an outfit. Make only these changes: ${instructions.join("; ")}. Everything else stays exactly as it is: the same person, face, hair, skin and body shape; every garment's exact color, fade, print, lettering, fabric, seams, fit and length; the same background, lighting, camera angle and framing. Do not add, remove or swap any clothing or accessories. Return only the edited photo.`;
}

/** The same brief as a sentence for the mannequin's single dressing call. */
export function stylingSentence(instructions: string[]): string {
  return instructions.length ? ` Wear and pose them like this: ${instructions.join("; ")}.` : "";
}

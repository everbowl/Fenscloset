/** Client-safe half of the rules: which input a rule wants, read from its key and the value it holds. */

export const ON_WORDS = ["on", "true", "yes", "1"];
export const OFF_WORDS = ["off", "false", "no", "0"];

export type RuleChoice = { value: string; label: string };
/** Rules that take one of a fixed set of values: a select on the Rules page, checked on save. */
export const RULE_CHOICES: Record<string, RuleChoice[]> = {
  mirrorEngine: [
    { value: "google", label: "Google" },
    { value: "fashn", label: "FASHN" },
    { value: "kling", label: "Kling" },
    { value: "compare", label: "Compare: every engine, side by side" },
  ],
};

export type RuleKind = "choice" | "onoff" | "color" | "text" | "number";

/** The words on the Rules page, by key: one plain line each, no build notes, no key names. (The row in the database keeps the value; the copy lives here.) */
export const RULE_COPY: Record<string, { label: string; description: string; unit?: string }> = {
  noRepeatDays: { label: "Days before a piece repeats", description: "A piece worn within this many days is not suggested again.", unit: "days" },
  notWornMonths: { label: "Months before a clean-out nudge", description: "A piece not worn in this many months lands on the Clean-out list.", unit: "months" },
  timezone: { label: "Household time zone", description: "When “today” starts for check-ins, looks and the Fits calendar." },
  accentColor: { label: "Button color", description: "The color of the main buttons. Everything else stays black and white." },
  mirrorEngine: { label: "Mirror engine", description: "Who dresses a look on a body photo. Compare runs every engine that is set up and shows them side by side." },
  wantSweepHours: { label: "Hours between store searches", description: "How often the Shop searches the stores again for Looking-for lines and for what is new from favorite brands. 24 is once a day; 0 turns the automatic search off.", unit: "hours" },
  sizeBandXsMaxLb: { label: "XS up to", description: "", unit: "lb" },
  sizeBandSMaxLb: { label: "S up to", description: "", unit: "lb" },
  sizeBandMMaxLb: { label: "M up to", description: "", unit: "lb" },
  sizeBandLMaxLb: { label: "L up to", description: "", unit: "lb" },
  sizeBandXlMaxLb: { label: "XL up to", description: "Above this, XXL.", unit: "lb" },
  sizeTallIn: { label: "Tall from", description: "One letter size up.", unit: "in" },
  sizeShortIn: { label: "Short up to", description: "One letter size down.", unit: "in" },
  waistDivisorX10: { label: "Waist divisor ×10", description: "Likely waist ≈ weight ÷ (this ÷ 10), nudged by height. 55 means 170 lb → about 31." },
};

/** The order and the headings on the Rules page. Keys not listed here show at the end under Other. */
/** `advanced` groups fold under one "Advanced" heading on the Rules page (Jeff, 31 Oct 2026, R1). */
export const RULE_GROUPS: { title: string; blurb?: string; keys: string[]; compact?: boolean; advanced?: boolean }[] = [
  { title: "Outfits", keys: ["noRepeatDays", "notWornMonths"] },
  { title: "Household", keys: ["timezone", "accentColor"] },
  { title: "Mirror", keys: ["mirrorEngine"], advanced: true },
  { title: "Shop", keys: ["wantSweepHours"] },
  { title: "Likely sizes", blurb: "A starting point from height and weight, shown on the Body page and offered when someone records a size.", keys: ["sizeBandXsMaxLb", "sizeBandSMaxLb", "sizeBandMMaxLb", "sizeBandLMaxLb", "sizeBandXlMaxLb", "sizeTallIn", "sizeShortIn", "waistDivisorX10"], compact: true, advanced: true },
];

/** US time zones in plain words; anything else is typed. */
export const TIMEZONE_CHOICES: RuleChoice[] = [
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
];

/** Six accents that carry white text well enough, plus the orange. */
export const ACCENT_PRESETS: { value: string; label: string }[] = [
  { value: "#FF5A00", label: "Orange" }, { value: "#C2410C", label: "Rust" }, { value: "#B91C1C", label: "Red" },
  { value: "#1D4ED8", label: "Blue" }, { value: "#047857", label: "Green" }, { value: "#000000", label: "Black" },
];

/** A fixed choice, on/off, a color, free text (the time zone), else a whole number. */
export function ruleKind(rule: { key: string; value: string }): RuleKind {
  if (rule.key in RULE_CHOICES) return "choice";
  const v = rule.value.toLowerCase();
  if (ON_WORDS.includes(v) || OFF_WORDS.includes(v)) return "onoff";
  if (/^#[0-9a-f]{6}$/i.test(rule.value)) return "color";
  if (rule.key === "timezone") return "text";
  return "number";
}

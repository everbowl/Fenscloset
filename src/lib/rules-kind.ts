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
    { value: "compare", label: "Compare: the engines switched on, side by side" },
  ],
};

export type RuleKind = "choice" | "onoff" | "color" | "text" | "number";

/** Which input a rule wants is decided by its key, never by the value it happens to hold (review E D1: a number rule set to 0 or 1 turned into an On/Off toggle). */
export const RULE_ONOFF_KEYS: string[] = ["compareGoogle", "compareFashn", "compareKling"];
export const RULE_COLOR_KEYS: string[] = ["accentColor"];
export const RULE_TEXT_KEYS: string[] = ["timezone"];

/** The words on the Rules page, by key: one plain line each, no build notes, no key names. (The row in the database keeps the value; the copy lives here.) */
export const RULE_COPY: Record<string, { label: string; description: string; unit?: string }> = {
  noRepeatDays: { label: "Days before a piece repeats", description: "A piece worn within this many days is not suggested again.", unit: "days" },
  notWornMonths: { label: "Months before a clean-out nudge", description: "A piece not worn in this many months lands on the Clean-out list.", unit: "months" },
  laundryCycleDays: { label: "Days between washes", description: "With ten of the same shirt, this says how many you really need: the Clean-out suggests the rest can go.", unit: "days" },
  needSnoozeDays: { label: "Days a Not now lasts", description: "Not now on a What’s-needed row of the Closet hides that row for this many days.", unit: "days" },
  aiPerPersonClaude: { label: "Claude calls per person per day", description: "Tagging, reading labels, the Shop's verdicts, outfit ideas, notes. Floor 1.", unit: "a day" },
  aiPerPersonTryOn: { label: "Try-ons per person per day", description: "Dressings on your body photo (Google, FASHN, Kling), Compare counted once per engine. Floor 1.", unit: "a day" },
  aiPerPersonRemoveBg: { label: "Photo cut-outs per person per day", description: "remove.bg background removal on added pieces. Floor 1.", unit: "a day" },
  aiPerPersonShop: { label: "Shop lookups per person per day", description: "Product searches (Serper); a cached answer is free. Floor 1.", unit: "a day" },
  aiPerPersonGoogleImage: { label: "Image redraws per person per day", description: "Google's image model: the mannequin and styling passes. Floor 1.", unit: "a day" },
  aiHouseholdPerDay: { label: "AI calls per household per day", description: "Every paid call by everyone, background sweeps included. When it is reached, nothing more runs until tomorrow. Floor 1.", unit: "a day" },
  timezone: { label: "Household time zone", description: "When “today” starts for check-ins, looks and the Fits calendar." },
  accentColor: { label: "Button color", description: "The color of the main buttons. Everything else stays black and white." },
  mirrorEngine: { label: "Mirror engine", description: "Who dresses a look on a body photo. Compare runs the engines switched on below, side by side." },
  compareGoogle: { label: "Compare includes Google", description: "Off leaves Google out of Compare without removing its key." },
  compareFashn: { label: "Compare includes FASHN", description: "Off leaves FASHN out of Compare without removing its key." },
  compareKling: { label: "Compare includes Kling", description: "Off leaves Kling out of Compare without removing its key. Kling needs a paid balance." },
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
  { title: "Outfits", keys: ["noRepeatDays", "notWornMonths", "laundryCycleDays"] },
  { title: "Closet", keys: ["needSnoozeDays"] },
  { title: "Household", keys: ["timezone", "accentColor"] },
  { title: "Mirror", keys: ["mirrorEngine", "compareGoogle", "compareFashn", "compareKling"], advanced: true },
  { title: "Shop", keys: ["wantSweepHours"] },
  { title: "AI allowance", blurb: "Daily caps on the paid AI calls, per person and for the whole household. A person past their cap sees a friendly line and tries tomorrow; an import waits instead of failing. Background work (the Looking-for sweep, an import with nobody signed in) counts as one more person. Each number has a floor of 1.", keys: ["aiPerPersonClaude", "aiPerPersonTryOn", "aiPerPersonRemoveBg", "aiPerPersonShop", "aiPerPersonGoogleImage", "aiHouseholdPerDay"], compact: true, advanced: true },
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

/** A fixed choice, on/off, a color, free text (the time zone), else a whole number: read from the key alone. */
export function ruleKind(rule: { key: string; value?: string }): RuleKind {
  if (rule.key in RULE_CHOICES) return "choice";
  if (RULE_ONOFF_KEYS.includes(rule.key)) return "onoff";
  if (RULE_COLOR_KEYS.includes(rule.key)) return "color";
  if (RULE_TEXT_KEYS.includes(rule.key)) return "text";
  // A rule the app does not know (the seed makes none like it): only then does its stored value say what it is. A known
  // number rule saved as 0 or 1 stays a number (review E D1).
  if (!(rule.key in RULE_COPY) && rule.value !== undefined && [...ON_WORDS, ...OFF_WORDS].includes(rule.value.trim().toLowerCase())) return "onoff";
  return "number";
}

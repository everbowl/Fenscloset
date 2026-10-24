/** Client-safe half of the rules: which input a rule wants, read from its key and the value it holds. */

export const ON_WORDS = ["on", "true", "yes", "1"];
export const OFF_WORDS = ["off", "false", "no", "0"];

export type RuleChoice = { value: string; label: string };
/** Rules that take one of a fixed set of values: a select on the Rules page, checked on save. */
export const RULE_CHOICES: Record<string, RuleChoice[]> = {
  mirrorEngine: [
    { value: "google", label: "Google" },
    { value: "fashn", label: "FASHN" },
    { value: "compare", label: "Compare: both, side by side" },
  ],
};

export type RuleKind = "choice" | "onoff" | "color" | "text" | "number";

/** A fixed choice, on/off, a color, free text (the time zone), else a whole number. */
export function ruleKind(rule: { key: string; value: string }): RuleKind {
  if (rule.key in RULE_CHOICES) return "choice";
  const v = rule.value.toLowerCase();
  if (ON_WORDS.includes(v) || OFF_WORDS.includes(v)) return "onoff";
  if (/^#[0-9a-f]{6}$/i.test(rule.value)) return "color";
  if (rule.key === "timezone") return "text";
  return "number";
}

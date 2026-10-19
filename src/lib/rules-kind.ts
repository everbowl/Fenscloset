/** Client-safe half of the rules: which input a rule wants, read from the value it holds. */

export const ON_WORDS = ["on", "true", "yes", "1"];
export const OFF_WORDS = ["off", "false", "no", "0"];

export type RuleKind = "onoff" | "color" | "text" | "number";

/** On/off, a color, free text (the time zone), else a whole number. */
export function ruleKind(rule: { key: string; value: string }): RuleKind {
  const v = rule.value.toLowerCase();
  if (ON_WORDS.includes(v) || OFF_WORDS.includes(v)) return "onoff";
  if (/^#[0-9a-f]{6}$/i.test(rule.value)) return "color";
  if (rule.key === "timezone") return "text";
  return "number";
}

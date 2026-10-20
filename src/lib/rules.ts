import { db } from "@/lib/db";
import { OFF_WORDS, ON_WORDS, ruleKind } from "@/lib/rules-kind";

export type RuleRow = { key: string; value: string; label: string; description: string };

export async function getRules(): Promise<RuleRow[]> {
  return db.rule.findMany({ orderBy: { key: "asc" } });
}

export async function getRuleNumber(key: string, fallback: number): Promise<number> {
  const r = await db.rule.findUnique({ where: { key } });
  const n = r ? Number(r.value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export async function getRuleText(key: string, fallback: string): Promise<string> {
  const r = await db.rule.findUnique({ where: { key } });
  return r?.value?.trim() || fallback;
}

/** The main-button color from Admin → Rules, as a hex the stylesheet can take; the default when the value is not a hex. */
export async function accentColor(): Promise<string> {
  const v = await getRuleText("accentColor", "#FF5A00");
  return /^#[0-9a-f]{6}$/i.test(v) ? v : "#FF5A00";
}

/** An on/off rule ("on" / "off" in the row; a few other spellings are read kindly). */
export async function getRuleFlag(key: string, fallback: boolean): Promise<boolean> {
  const v = (await getRuleText(key, "")).toLowerCase();
  if (ON_WORDS.includes(v)) return true;
  if (OFF_WORDS.includes(v)) return false;
  return fallback;
}

export { ruleKind };

export async function setRule(key: string, value: string): Promise<RuleRow> {
  const existing = await db.rule.findUnique({ where: { key } });
  if (!existing) throw new Error("Unknown rule");
  const kind = ruleKind(existing);
  if (kind === "text") {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }); } catch { throw new Error("Enter a time zone like America/Los_Angeles."); }
    return db.rule.update({ where: { key }, data: { value: value.trim() } });
  }
  if (kind === "onoff") {
    const v = value.trim().toLowerCase();
    if (!ON_WORDS.includes(v) && !OFF_WORDS.includes(v)) throw new Error("Choose on or off.");
    return db.rule.update({ where: { key }, data: { value: ON_WORDS.includes(v) ? "on" : "off" } });
  }
  if (kind === "color") {
    const v = value.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(v)) throw new Error("Enter a color like #FF5A00.");
    return db.rule.update({ where: { key }, data: { value: v } });
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 3650) throw new Error("Enter a whole number between 0 and 3650.");
  return db.rule.update({ where: { key }, data: { value: String(n) } });
}

export async function getTimezone(): Promise<string> {
  const r = await db.rule.findUnique({ where: { key: "timezone" } });
  return r?.value || "America/Los_Angeles";
}

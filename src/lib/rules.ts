import { db } from "@/lib/db";

export type RuleRow = { key: string; value: string; label: string; description: string };

export async function getRules(): Promise<RuleRow[]> {
  return db.rule.findMany({ orderBy: { key: "asc" } });
}

export async function getRuleNumber(key: string, fallback: number): Promise<number> {
  const r = await db.rule.findUnique({ where: { key } });
  const n = r ? Number(r.value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export async function setRule(key: string, value: string): Promise<RuleRow> {
  const existing = await db.rule.findUnique({ where: { key } });
  if (!existing) throw new Error("Unknown rule");
  if (key === "timezone") {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }); } catch { throw new Error("Enter a time zone like America/Los_Angeles."); }
    return db.rule.update({ where: { key }, data: { value: value.trim() } });
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 3650) throw new Error("Enter a whole number between 0 and 3650.");
  return db.rule.update({ where: { key }, data: { value: String(n) } });
}

export async function getTimezone(): Promise<string> {
  const r = await db.rule.findUnique({ where: { key: "timezone" } });
  return r?.value || "America/Los_Angeles";
}

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
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 3650) throw new Error("Enter a whole number between 0 and 3650.");
  return db.rule.update({ where: { key }, data: { value: String(n) } });
}

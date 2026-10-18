import { db } from "@/lib/db";
import type { Board } from "@/lib/outfits/engine";

/**
 * Taste memory. Every time looks are offered, what the person did with them is kept:
 * worn (tapped WEAR THIS or saved a fit), passed (saw it, chose another or asked for more),
 * swapped_out / swapped_in (changed one piece). A short digest of the last 90 days goes into every
 * suggestion so the looks drift toward what they actually choose. The person can forget any line
 * on their Style page.
 */

const WINDOW_DAYS = 90;
const MAX_LINES = 10;

const sortedKey = (ids: string[]) => [...ids].sort().join(",");

/** One worn look per day: wearing a second look replaces the first, like the fit itself. */
export async function recordWorn(personId: string, date: string, itemIds: string[]): Promise<void> {
  if (!itemIds.length) return;
  await db.lookFeedback.deleteMany({ where: { personId, date, kind: "worn" } });
  await db.lookFeedback.create({ data: { personId, date, kind: "worn", itemIds } });
}

/** Looks the person saw and did not wear. One record per distinct look per day. */
export async function recordPassed(personId: string, date: string, boards: Board[]): Promise<void> {
  if (!boards.length) return;
  const existing = await db.lookFeedback.findMany({ where: { personId, date, kind: { in: ["passed", "worn"] } }, select: { itemIds: true } });
  const seen = new Set(existing.map((e) => sortedKey(e.itemIds)));
  const fresh = boards.filter((b) => b.itemIds.length && !seen.has(sortedKey(b.itemIds)) && seen.add(sortedKey(b.itemIds)));
  if (fresh.length) await db.lookFeedback.createMany({ data: fresh.map((b) => ({ personId, date, kind: "passed" as const, itemIds: b.itemIds })) });
}

export async function recordSwap(personId: string, date: string, outId: string, inId: string, itemIds: string[]): Promise<void> {
  await db.lookFeedback.createMany({ data: [
    { personId, date, kind: "swapped_out", itemIds, itemId: outId },
    { personId, date, kind: "swapped_in", itemIds, itemId: inId },
  ] });
}

export type TasteLine = { key: string; itemIds: string[]; text: string };

/** The learned lines, resolved to names, for the prompt and the Style page. */
export async function tasteLines(personId: string, now = new Date()): Promise<TasteLine[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86400000);
  const rows = await db.lookFeedback.findMany({ where: { personId, createdAt: { gte: since } }, orderBy: { createdAt: "asc" } });
  if (!rows.length) return [];
  const worn = new Map<string, number>(), passed = new Map<string, number>(), swappedOut = new Map<string, number>(), swappedIn = new Map<string, number>();
  const pairs = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const r of rows) {
    if (r.kind === "worn") {
      r.itemIds.forEach((id) => bump(worn, id));
      const ids = [...new Set(r.itemIds)].sort();
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) bump(pairs, `${ids[i]},${ids[j]}`);
    } else if (r.kind === "passed") r.itemIds.forEach((id) => bump(passed, id));
    else if (r.kind === "swapped_out" && r.itemId) bump(swappedOut, r.itemId);
    else if (r.kind === "swapped_in" && r.itemId) bump(swappedIn, r.itemId);
  }
  const ids = [...new Set([...worn.keys(), ...passed.keys(), ...swappedOut.keys(), ...swappedIn.keys()])];
  const items = await db.item.findMany({ where: { id: { in: ids }, retiredAt: null }, select: { id: true, name: true } });
  const name = (id: string) => items.find((i) => i.id === id)?.name ?? null;
  const lines: TasteLine[] = [];
  const top = (m: Map<string, number>, min: number) => [...m.entries()].filter(([k, n]) => n >= min && k.split(",").every((id) => name(id))).sort((a, b) => b[1] - a[1]);
  for (const [id, n] of top(worn, 2).slice(0, 4)) lines.push({ key: `worn:${id}`, itemIds: [id], text: `Reaches for ${name(id)} (worn ${n}× when offered)` });
  for (const [id, n] of top(swappedOut, 2).slice(0, 3)) lines.push({ key: `out:${id}`, itemIds: [id], text: `Tends to swap out ${name(id)} (${n}×)` });
  for (const [id, n] of top(swappedIn, 2).slice(0, 2)) lines.push({ key: `in:${id}`, itemIds: [id], text: `Often swaps in ${name(id)} (${n}×)` });
  for (const [id, n] of top(passed, 3).filter(([id]) => !worn.has(id)).slice(0, 3)) lines.push({ key: `passed:${id}`, itemIds: [id], text: `Passed on looks with ${name(id)} ${n} times, never wore it` });
  for (const [k, n] of top(pairs, 2).slice(0, 3)) { const [a, b] = k.split(","); if (name(a) && name(b)) lines.push({ key: `pair:${k}`, itemIds: [a, b], text: `Wears ${name(a)} with ${name(b)} (${n}×)` }); }
  return lines.slice(0, MAX_LINES);
}

/** Prompt block, or "" when nothing is learned yet. */
export async function tasteContext(personId: string, now = new Date()): Promise<string> {
  const lines = await tasteLines(personId, now);
  return lines.length ? `Taste memory (what they actually chose, last ${WINDOW_DAYS} days; weigh this above the style words):\n${lines.map((l) => `- ${l.text}`).join("\n")}` : "";
}

/** Forget everything learned about one piece (or everything, with no itemId). */
export async function forgetTaste(personId: string, itemId?: string): Promise<void> {
  if (!itemId) { await db.lookFeedback.deleteMany({ where: { personId } }); return; }
  await db.lookFeedback.deleteMany({ where: { personId, OR: [{ itemId }, { itemIds: { has: itemId } }] } });
}

import { db } from "@/lib/db";

/**
 * Which part of a store a person shops in (Jeff, 2 Nov 2026: Looking-for brought back men's and women's jeans
 * together). The sections are an editable list (Lists → Shop sections); each person picks theirs. Every store
 * search starts with the section's word, and a result titled for another section is left out.
 */

export type SectionKey = "men" | "women" | "boys" | "girls";
const WORDS: Record<SectionKey, RegExp> = {
  men: /\b(?:men[’']s|mens|men|man[’']s|male)\b/,
  women: /\b(?:women[’']s|womens|women|woman[’']s|ladies|female)\b/,
  boys: /\b(?:boys[’']|boy[’']s|boys|boy)\b/,
  girls: /\b(?:girls[’']|girl[’']s|girls|girl)\b/,
};
const QUERY_WORD: Record<SectionKey, string> = { men: "men's", women: "women's", boys: "boys'", girls: "girls'" };
const KEYS = Object.keys(WORDS) as SectionKey[];

/** The section a name stands for ("Men's" → men, "Girls' (youth)" → girls), or null for a neutral one (Unisex). */
export function sectionKey(name: string | null | undefined): SectionKey | null {
  const t = (name ?? "").toLowerCase();
  return KEYS.find((k) => WORDS[k].test(t)) ?? null;
}

/** The word a search starts with for this section ("men's"), or null for a neutral one. */
export function sectionWord(section: string | null | undefined): string | null {
  const key = sectionKey(section);
  return key ? QUERY_WORD[key] : null;
}

/** Each search starts with the section's word unless it already names a section. Neutral sections leave searches alone. */
export function withSection(queries: string[], section: string | null | undefined): string[] {
  const key = sectionKey(section);
  if (!key) return queries;
  return queries.map((q) => (KEYS.some((k) => WORDS[k].test(q.toLowerCase())) ? q : `${QUERY_WORD[key]} ${q}`));
}

/** A result titled for another section only ("Women's Dojo Lake" for someone in Men's). A title naming both is kept. */
export function inOtherSection(title: string, section: string | null | undefined): boolean {
  const key = sectionKey(section);
  if (!key) return false;
  const t = title.toLowerCase();
  return !WORDS[key].test(t) && KEYS.some((k) => k !== key && WORDS[k].test(t));
}

/** The person's section, or null when none is picked (or it was archived from the list). */
export async function sectionOf(personId: string): Promise<{ id: string; name: string } | null> {
  const p = await db.person.findUnique({ where: { id: personId }, select: { shopSection: { select: { id: true, name: true, isArchived: true } } } });
  return p?.shopSection && !p.shopSection.isArchived ? { id: p.shopSection.id, name: p.shopSection.name } : null;
}

import { isMockAi, structured } from "@/lib/ai/claude";

/**
 * "Tell it in words" on a product card (Jeff, 2 Nov 2026): one line like "I own 7 of these, all Medium:
 * black ×2, navy, white, grey ×3" becomes rows of color, size and how many, for the bulk add. Claude reads
 * it against the page's own color and size names so the rows use them; the mock parser covers the tests.
 * Nothing here reaches a store: it is the person's words and the page's choice lists only.
 */

export type OwnedRow = { color: string | null; size: string | null; quantity: number };
export type OwnedPage = { name: string; colors: string[]; sizes: string[] };

const MAX_ROWS = 30;
const MAX_QTY = 10;

const SIZE_WORDS: Record<string, string> = { "extra small": "XS", xsmall: "XS", small: "S", medium: "M", large: "L", "extra large": "XL", xlarge: "XL", "x-large": "XL", "xx-large": "XXL", xxlarge: "XXL" };
const SIZE_TOKEN = /^(xxs|xs|s|m|l|xl|xxl|xxxl|\d{1,2}(?:\.\d)?|\d{2}x\d{2})$/i;

/** The page's spelling of a color or size when the words match one, else the words as typed. */
function pageName(list: string[], typed: string): string {
  const t = typed.trim().toLowerCase();
  return list.find((x) => x.toLowerCase() === t) ?? list.find((x) => x.toLowerCase().includes(t) || t.includes(x.toLowerCase())) ?? typed.trim();
}

function sizeOf(word: string, sizes: string[]): string | null {
  const w = word.trim().toLowerCase();
  const mapped = SIZE_WORDS[w] ?? (SIZE_TOKEN.test(w) ? w.toUpperCase() : null);
  if (!mapped) return null;
  return pageName(sizes, mapped);
}

function clampQty(n: number): number {
  return Math.min(MAX_QTY, Math.max(1, Math.floor(Number.isFinite(n) ? n : 1)));
}

/** Rows from plain patterns: "all M" / "size medium", "I own 7 of these", then "black ×2, navy, 3 white". Used in tests and when Claude is off. */
export function mockOwnedRows(text: string, page: OwnedPage): OwnedRow[] {
  let t = text.replace(/\s+/g, " ").trim();
  let size: string | null = null;
  const all = t.match(/\b(?:all|size|every one|everything)\s+(?:in\s+|size\s+)?([a-z0-9.-]+(?:\s+(?:small|large))?)\b/i);
  if (all) { const s = sizeOf(all[1], page.sizes); if (s) { size = s; t = t.replace(all[0], " "); } }
  let total: number | null = null;
  const own = t.match(/\b(?:i (?:own|have|got)|own|have)\s+(\d{1,2})\b(?:\s+of\s+(?:these|them|this))?/i);
  if (own) { total = Number(own[1]); t = t.replace(own[0], " "); }
  t = t.replace(/\b(?:of these|of them|shirts?|tees?|pieces?|colors?|colours?|in|the|these are|they are|and)\b/gi, " ").replace(/\s+/g, " ");
  const rows: OwnedRow[] = [];
  for (const raw of t.split(/[,;:\n]+|\s(?=\d+\s*[x×]?\s*[a-z])/i)) {
    const chunk = raw.replace(/[.!]+$/, "").trim();
    if (!chunk) continue;
    let m = chunk.match(/^(\d{1,2})\s*[x×]?\s*([a-z][a-z\s/-]*)$/i); // "2 black" / "2x black"
    let color: string; let qty: number;
    if (m) { qty = Number(m[1]); color = m[2]; }
    else if ((m = chunk.match(/^([a-z][a-z\s/-]*?)\s*[x×]\s*(\d{1,2})$/i))) { color = m[1]; qty = Number(m[2]); } // "black ×2"
    else if ((m = chunk.match(/^([a-z][a-z\s/-]*?)\s*\((\d{1,2})\)$/i))) { color = m[1]; qty = Number(m[2]); } // "black (2)"
    else if (/^[a-z][a-z\s/-]*$/i.test(chunk)) { color = chunk; qty = 1; }
    else continue;
    if (sizeOf(color, page.sizes) && !page.colors.some((c) => c.toLowerCase() === color.trim().toLowerCase())) continue; // a stray size word, not a color
    rows.push({ color: pageName(page.colors, color), size, quantity: clampQty(qty) });
  }
  if (!rows.length && total) rows.push({ color: null, size, quantity: clampQty(total) });
  return rows.slice(0, MAX_ROWS);
}

/** Claude reads the words into rows; the page's color and size names are used where they match. */
export async function ownedRowsFromWords(text: string, page: OwnedPage): Promise<OwnedRow[]> {
  const words = text.replace(/\s+/g, " ").trim().slice(0, 600);
  if (!words) return [];
  if (isMockAi()) return mockOwnedRows(words, page);
  const schema = {
    type: "object", additionalProperties: false, required: ["rows"],
    properties: {
      rows: {
        type: "array",
        description: "One row per color-and-size the person owns, with how many. Several colors at one size are several rows. \"All medium\" sets the size on every row. When no color is named, one row with color null. Never invent a color or size they did not say.",
        items: {
          type: "object", additionalProperties: false, required: ["color", "size", "quantity"],
          properties: {
            color: { type: ["string", "null"], description: "The page's spelling of the color when it matches one of the page's colors, else as the person wrote it; null when none was said." },
            size: { type: ["string", "null"], description: "The page's spelling of the size when it matches one of the page's sizes (medium → M), else as written; null when none was said." },
            quantity: { type: "integer", minimum: 1, description: "How many of this color and size; 1 when not said. If they gave a total and colors without counts, spread the total only when it divides evenly, else 1 each." },
          },
        },
      },
    },
  };
  const out = await structured<{ rows: OwnedRow[] }>({
    system: "You turn one person's note about clothes they already own into rows of color, size and quantity. Answer with JSON only.",
    prompt: [
      `The product: ${page.name}.`,
      page.colors.length ? `The page's colors: ${page.colors.join(", ")}.` : "The page lists no colors.",
      page.sizes.length ? `The page's sizes: ${page.sizes.join(", ")}.` : "The page lists no sizes.",
      `Their note: "${words}"`,
    ].join("\n"),
    schema, effort: "low", maxTokens: 500,
  });
  return (out.rows ?? []).slice(0, MAX_ROWS).map((r) => ({
    color: r.color ? pageName(page.colors, String(r.color)).slice(0, 40) : null,
    size: r.size ? pageName(page.sizes, String(r.size)).slice(0, 20) : null,
    quantity: clampQty(Number(r.quantity)),
  }));
}

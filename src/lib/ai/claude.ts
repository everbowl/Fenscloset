import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";

export class AiError extends Error {
  constructor(public readonly code: "no_key" | "refusal" | "bad_json" | "api", message: string) {
    super(message);
    this.name = "AiError";
  }
}

export function isMockAi(): boolean {
  return process.env.MOCK_AI === "true";
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiError("no_key", "ANTHROPIC_API_KEY is not set");
  // 60 s per attempt and one retry (review D 1.1 / B A2.4): the SDK's defaults (10 min × 3 tries) let one hung call pin a looks
  // job or an import slot for half an hour while the phone showed a counter.
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: Number(process.env.ANTHROPIC_TIMEOUT_MS) || 60_000 });
  return client;
}

export type StructuredRequest = {
  system: string;
  prompt: string;
  image?: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" };
  /** Several labelled pictures (e.g. the pieces of each look); each label is sent as text right before its image. */
  images?: { label: string; data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }[];
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
};

/** One vision/text call that must come back as JSON matching `schema`. Server-side refusal fallbacks are on. */
export async function structured<T>(req: StructuredRequest, retried = false): Promise<T> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.image) content.push({ type: "image", source: { type: "base64", media_type: req.image.mediaType, data: req.image.data } });
  for (const im of req.images ?? []) {
    content.push({ type: "text", text: im.label });
    content.push({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.data } });
  }
  content.push({ type: "text", text: req.prompt });
  let res: Anthropic.Beta.BetaMessage;
  const t0 = Date.now();
  try {
    res = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: req.maxTokens ?? 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      output_config: { effort: req.effort ?? "low", format: { type: "json_schema", schema: req.schema } },
      messages: [{ role: "user", content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new AiError("api", `${e.status ?? ""} ${e.message}`.trim());
    throw e;
  }
  // One line per call so the slow one can be found (review D 1.4): model, effort, tokens in/out (+ cache reads), ms, how it stopped.
  const u = res.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | undefined;
  console.info(`claude: ${MODEL} effort=${req.effort ?? "low"} in=${u?.input_tokens ?? "?"} out=${u?.output_tokens ?? "?"}${u?.cache_read_input_tokens ? ` cached=${u.cache_read_input_tokens}` : ""} ${Date.now() - t0}ms stop=${res.stop_reason}`);
  if (res.stop_reason === "refusal") throw new AiError("refusal", "The model declined this request.");
  // Thinking counts toward max_tokens: a cut-off answer is cut-off JSON. Say so instead of repeating the whole call (review D 1.2).
  if (res.stop_reason === "max_tokens") throw new AiError("api", `The model ran out of room (max_tokens ${req.maxTokens ?? 2000}).`);
  const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
  const parsed = parseJsonLoose<T>(text);
  if (parsed !== undefined) return parsed;
  if (!retried) return structured<T>(req, true); // one more try before giving up: a stray sentence around the JSON is the usual cause
  throw new AiError("bad_json", "The model returned something that was not JSON.");
}

/** JSON.parse, else the first {…} or […] block inside the text (models sometimes wrap the answer in a sentence or a code fence). */
export function parseJsonLoose<T>(text: string): T | undefined {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t) as T; } catch { /* fall through */ }
  const start = Math.min(...[t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0));
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (!Number.isFinite(start) || end <= start) return undefined;
  try { return JSON.parse(t.slice(start, end + 1)) as T; } catch { return undefined; }
}

import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

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
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
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
export async function structured<T>(req: StructuredRequest): Promise<T> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.image) content.push({ type: "image", source: { type: "base64", media_type: req.image.mediaType, data: req.image.data } });
  for (const im of req.images ?? []) {
    content.push({ type: "text", text: im.label });
    content.push({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.data } });
  }
  content.push({ type: "text", text: req.prompt });
  let res: Anthropic.Beta.BetaMessage;
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
  if (res.stop_reason === "refusal") throw new AiError("refusal", "The model declined to tag this photo.");
  const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AiError("bad_json", "The model returned something that was not JSON.");
  }
}

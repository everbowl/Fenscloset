import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { fashnCategory, fashnTryOn, FashnError, FASHN_API } from "@/lib/tryon/fashn";
import { engineRuleOf, resolveEngines } from "@/lib/tryon/engines";

const jpeg = () => sharp({ create: { width: 24, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
const picture = Buffer.from("89504e470d0a1a0a", "hex"); // any bytes will do for "the picture"

type Call = { url: string; method: string; headers: Record<string, string>; body?: Record<string, unknown> };
/** A FASHN that answers /run with a job id, then the statuses in order (the last one repeats), then the picture when it is linked. */
function fakeFashn(statuses: object[], calls: Call[], opts: { run?: Response; link?: Response } = {}): typeof fetch {
  let i = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = { ...((init?.headers as Record<string, string>) ?? {}) };
    calls.push({ url, method: init?.method ?? "GET", headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === `${FASHN_API}/run`) return opts.run ?? new Response(JSON.stringify({ id: "job-1", error: null }), { status: 200 });
    if (url.startsWith(`${FASHN_API}/status/`)) return new Response(JSON.stringify(statuses[Math.min(i++, statuses.length - 1)]), { status: 200 });
    return opts.link ?? new Response(picture, { status: 200, headers: { "content-type": "image/png" } });
  }) as typeof fetch;
}

describe("FASHN try-on client", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.FASHN_API_KEY = "test-key"; process.env.FASHN_POLL_MS = "5";
    delete process.env.MOCK_FASHN; delete process.env.FASHN_MODERATION; delete process.env.FASHN_SEGMENTATION_FREE; delete process.env.FASHN_TIMEOUT_MS;
  });
  afterEach(() => { process.env = { ...env }; });

  it("starts a job with the permissive, segmentation-free brief, polls until it completes, and returns the inline picture", async () => {
    const calls: Call[] = [];
    const inline = `data:image/jpeg;base64,${picture.toString("base64")}`;
    const out = await fashnTryOn(await jpeg(), await jpeg(), "tops", fakeFashn([{ status: "in_queue" }, { status: "processing" }, { status: "completed", output: [inline] }], calls));
    expect(out.data.equals(picture)).toBe(true);
    expect(out.mimeType).toBe("image/jpeg");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.Authorization).toBe("Bearer test-key");
    expect(calls[0].body).toMatchObject({ model_name: "tryon-v1.6", inputs: { category: "tops", mode: "balanced", garment_photo_type: "auto", moderation_level: "permissive", segmentation_free: true, output_format: "jpeg", return_base64: true } });
    expect((calls[0].body!.inputs as { model_image: string }).model_image).toMatch(/^data:image\/jpeg;base64,/);
    expect(calls.filter((c) => c.url.endsWith("/status/job-1")).length).toBe(3);
  });

  it("a linked picture is fetched; FASHN_MODERATION and FASHN_SEGMENTATION_FREE pass through", async () => {
    process.env.FASHN_MODERATION = "conservative"; process.env.FASHN_SEGMENTATION_FREE = "false";
    const calls: Call[] = [];
    const out = await fashnTryOn(await jpeg(), await jpeg(), "bottoms", fakeFashn([{ status: "completed", output: ["https://cdn.fashn.ai/out.png"] }], calls));
    expect(out.mimeType).toBe("image/png");
    expect(out.data.equals(picture)).toBe(true);
    expect(calls[0].body).toMatchObject({ inputs: { category: "bottoms", moderation_level: "conservative", segmentation_free: false } });
    expect(calls.at(-1)!.url).toBe("https://cdn.fashn.ai/out.png");
  });

  it("failures say what happened: moderation, pose, a refused key, no credits, a job that never finishes, no key at all", async () => {
    const calls: Call[] = [];
    await expect(fashnTryOn(await jpeg(), await jpeg(), "tops", fakeFashn([{ status: "failed", error: { name: "ContentModerationError", message: "nsfw" } }], calls))).rejects.toMatchObject({ code: "moderation", status: 422 });
    await expect(fashnTryOn(await jpeg(), await jpeg(), "tops", fakeFashn([{ status: "failed", error: { name: "PoseError", message: "no person" } }], calls))).rejects.toThrow(/full-body photo/);
    await expect(fashnTryOn(await jpeg(), await jpeg(), "tops", fakeFashn([], calls, { run: new Response("nope", { status: 401 }) }))).rejects.toMatchObject({ code: "key", status: 503 });
    await expect(fashnTryOn(await jpeg(), await jpeg(), "tops", fakeFashn([], calls, { run: new Response("", { status: 402 }) }))).rejects.toMatchObject({ code: "credits" });
    process.env.FASHN_TIMEOUT_MS = "20";
    await expect(fashnTryOn(await jpeg(), await jpeg(), "tops", fakeFashn([{ status: "processing" }], calls))).rejects.toMatchObject({ code: "timeout", status: 504 });
    delete process.env.FASHN_API_KEY;
    await expect(fashnTryOn(await jpeg(), await jpeg(), "tops", fakeFashn([], calls))).rejects.toMatchObject({ code: "no_key" });
    expect(new FashnError("x").name).toBe("FashnError");
  });

  it("MOCK_FASHN pastes the garment on without calling anyone", async () => {
    process.env.MOCK_FASHN = "true";
    const calls: Call[] = [];
    const out = await fashnTryOn(await jpeg(), await jpeg(), "tops", fakeFashn([], calls));
    expect(calls).toEqual([]);
    const meta = await sharp(out.data).metadata();
    expect([meta.width, meta.height]).toEqual([600, 800]);
  });

  it("our categories map to FASHN's; shoes are not placed", () => {
    expect(fashnCategory("Tops")).toBe("tops");
    expect(fashnCategory("Outerwear")).toBe("tops");
    expect(fashnCategory("Bottoms")).toBe("bottoms");
    expect(fashnCategory("Dresses")).toBe("one-pieces");
    expect(fashnCategory("Shoes")).toBeNull();
    expect(fashnCategory("Accessories")).toBe("auto");
    expect(fashnCategory(null)).toBe("auto");
  });

  it("the rule and the keys decide who dresses: the chosen one, both for Compare, a stand-in and a note when a key is missing", () => {
    expect(engineRuleOf("fashn")).toBe("fashn");
    expect(engineRuleOf("compare")).toBe("compare");
    expect(engineRuleOf("nonsense")).toBe("google");
    expect(engineRuleOf(null)).toBe("google");
    expect(resolveEngines("google", { google: true, fashn: true })).toEqual({ engines: ["google"] });
    expect(resolveEngines("compare", { google: true, fashn: true })).toEqual({ engines: ["google", "fashn"] });
    const noKey = resolveEngines("fashn", { google: true, fashn: false });
    expect(noKey.engines).toEqual(["google"]);
    expect(noKey.note).toBe("FASHN isn’t set up yet: no FASHN_API_KEY in Railway. Google dressed this one.");
    const half = resolveEngines("compare", { google: true, fashn: false });
    expect(half.engines).toEqual(["google"]);
    expect(half.note).toMatch(/^FASHN isn’t set up yet/);
    expect(resolveEngines("google", { google: false, fashn: true })).toMatchObject({ engines: ["fashn"] });
    expect(resolveEngines("compare", { google: false, fashn: false }).engines).toEqual([]);
  });
});

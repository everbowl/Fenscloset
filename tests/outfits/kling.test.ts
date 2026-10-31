import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import sharp from "sharp";
import { isKlingConfigured, klingBase, KLING_PATH, klingToken, klingTryOn, mockKling } from "@/lib/tryon/kling";

const jpeg = () => sharp({ create: { width: 24, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
const picture = Buffer.from("89504e470d0a1a0a", "hex");

type Call = { url: string; method: string; headers: Record<string, string>; body?: Record<string, unknown> };
/** A Kling that answers the create call with a task, then the task statuses in order (the last one repeats), then the picture at its link. */
function fakeKling(statuses: object[], calls: Call[], opts: { create?: Response } = {}): typeof fetch {
  let i = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = { ...((init?.headers as Record<string, string>) ?? {}) };
    calls.push({ url, method: init?.method ?? "GET", headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === `${klingBase()}${KLING_PATH}` && init?.method === "POST") return opts.create ?? new Response(JSON.stringify({ code: 0, message: "SUCCEED", request_id: "r1", data: { task_id: "task-1", task_status: "submitted" } }), { status: 200 });
    if (url.startsWith(`${klingBase()}${KLING_PATH}/`)) return new Response(JSON.stringify(statuses[Math.min(i++, statuses.length - 1)]), { status: 200 });
    return new Response(picture, { status: 200, headers: { "content-type": "image/png" } });
  }) as typeof fetch;
}
const done = (url: string) => ({ code: 0, data: { task_id: "task-1", task_status: "succeed", task_result: { images: [{ index: 0, url }] } } });

describe("Kling try-on client", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.KLING_ACCESS_KEY = "ak-test"; process.env.KLING_SECRET_KEY = "sk-test"; process.env.KLING_POLL_MS = "5";
    delete process.env.MOCK_KLING; delete process.env.KLING_API_BASE; delete process.env.KLING_MODEL; delete process.env.KLING_TIMEOUT_MS;
  });
  afterEach(() => { process.env = { ...env }; });

  it("signs a short-lived token with the secret key: the access key as the issuer, good for 30 minutes", () => {
    const tok = klingToken("ak-test", "sk-test", 1_700_000_000_000);
    const [h, b, sig] = tok.split(".");
    const dec = (s: string) => JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    expect(dec(h)).toEqual({ alg: "HS256", typ: "JWT" });
    expect(dec(b)).toEqual({ iss: "ak-test", exp: 1_700_000_000 + 1800, nbf: 1_700_000_000 - 5 });
    const expected = createHmac("sha256", "sk-test").update(`${h}.${b}`).digest("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    expect(sig).toBe(expected);
    expect(isKlingConfigured()).toBe(true);
    delete process.env.KLING_SECRET_KEY;
    expect(isKlingConfigured()).toBe(false);
    process.env.MOCK_KLING = "true";
    expect(isKlingConfigured()).toBe(true);
  });

  it("creates a task with plain base64 pictures and the bearer token, polls until it succeeds, fetches the picture", async () => {
    const calls: Call[] = [];
    const out = await klingTryOn(await jpeg(), await jpeg(), fakeKling([{ code: 0, data: { task_status: "submitted" } }, { code: 0, data: { task_status: "processing" } }, done("https://cdn.kling.example/out.png")], calls));
    expect(out.data.equals(picture)).toBe(true);
    expect(out.mimeType).toBe("image/png");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://api-singapore.klingai.com/v1/images/kolors-virtual-try-on");
    expect(calls[0].headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(calls[0].body).toMatchObject({ model_name: "kolors-virtual-try-on-v1-5" });
    expect(String(calls[0].body!.human_image)).toMatch(/^[A-Za-z0-9+/]+=*$/); // no data: prefix
    expect(calls.filter((c) => c.url.endsWith("/task-1")).length).toBe(3);
    expect(calls.at(-1)!.url).toBe("https://cdn.kling.example/out.png");
  });

  it("KLING_API_BASE and KLING_MODEL pass through", async () => {
    process.env.KLING_API_BASE = "https://api.klingai.com/"; process.env.KLING_MODEL = "kolors-virtual-try-on-v1";
    const calls: Call[] = [];
    await klingTryOn(await jpeg(), await jpeg(), fakeKling([done("https://cdn.kling.example/a.jpg")], calls));
    expect(calls[0].url).toBe("https://api.klingai.com/v1/images/kolors-virtual-try-on");
    expect(calls[0].body).toMatchObject({ model_name: "kolors-virtual-try-on-v1" });
  });

  it("failures say what happened: refused keys, no credits, the filters, a failed task, a task that never finishes, no keys at all", async () => {
    const calls: Call[] = [];
    const reply = (code: number, message: string) => new Response(JSON.stringify({ code, message, request_id: "r" }), { status: 200 });
    await expect(klingTryOn(await jpeg(), await jpeg(), fakeKling([], calls, { create: reply(1000, "auth failed") }))).rejects.toMatchObject({ code: "key", status: 503 });
    await expect(klingTryOn(await jpeg(), await jpeg(), fakeKling([], calls, { create: new Response("nope", { status: 401 }) }))).rejects.toMatchObject({ code: "key" });
    await expect(klingTryOn(await jpeg(), await jpeg(), fakeKling([], calls, { create: reply(1102, "insufficient balance") }))).rejects.toMatchObject({ code: "credits" });
    await expect(klingTryOn(await jpeg(), await jpeg(), fakeKling([], calls, { create: reply(1301, "trigger strategy") }))).rejects.toMatchObject({ code: "moderation", status: 422 });
    await expect(klingTryOn(await jpeg(), await jpeg(), fakeKling([{ code: 0, data: { task_status: "failed", task_status_msg: "no human detected" } }], calls))).rejects.toThrow(/full-body photo/);
    process.env.KLING_TIMEOUT_MS = "20";
    await expect(klingTryOn(await jpeg(), await jpeg(), fakeKling([{ code: 0, data: { task_status: "processing" } }], calls))).rejects.toMatchObject({ code: "timeout", status: 504 });
    delete process.env.KLING_ACCESS_KEY;
    await expect(klingTryOn(await jpeg(), await jpeg(), fakeKling([], calls))).rejects.toMatchObject({ code: "no_key", status: 503 });
  });

  it("the mock pastes the garment on with its own tint and never calls out", async () => {
    process.env.MOCK_KLING = "true";
    const calls: Call[] = [];
    const out = await klingTryOn(await jpeg(), await jpeg(), fakeKling([], calls));
    expect(calls).toHaveLength(0);
    expect(out.mimeType).toBe("image/jpeg");
    const meta = await sharp(out.data).metadata();
    expect([meta.width, meta.height]).toEqual([600, 800]);
    expect((await mockKling(await jpeg(), await jpeg())).length).toBeGreaterThan(0);
  });
});

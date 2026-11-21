import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { isKlingConfigured, klingAuth, klingBase, KLING_CREATE_PATH, KLING_QUERY_PATH, klingPicture, klingToken, klingTryOn, mockKling } from "@/lib/tryon/kling";

const jpeg = (w = 24, h = 32) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();
const picture = Buffer.from("89504e470d0a1a0a", "hex");
const PERSON = "cmkl1ngt3stp3rs0n00000001"; // shaped like a database id, as the bucket keys expect

type Call = { url: string; method: string; headers: Record<string, string>; body?: Record<string, unknown> };
/** A Kling 3.0 that answers the create call with a task, then the task in the statuses given in order (the last one repeats), then the picture at its link. */
function fakeKling(statuses: object[], calls: Call[], opts: { create?: Response } = {}): typeof fetch {
  let i = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = { ...((init?.headers as Record<string, string>) ?? {}) };
    calls.push({ url, method: init?.method ?? "GET", headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === `${klingBase()}${KLING_CREATE_PATH}` && init?.method === "POST") return opts.create ?? new Response(JSON.stringify({ code: 0, message: "SUCCEED", request_id: "r1", data: { task_id: "task-1", status: "submitted" } }), { status: 200 });
    if (url.startsWith(`${klingBase()}${KLING_QUERY_PATH}?task_ids=`)) return new Response(JSON.stringify(statuses[Math.min(i++, statuses.length - 1)]), { status: 200 });
    return new Response(picture, { status: 200, headers: { "content-type": "image/png" } });
  }) as typeof fetch;
}
const task = (status: string, extra: Partial<{ message: string; outputs: { type: string; url: string }[] }> = {}) => ({ code: 0, message: "SUCCEED", data: [{ id: "task-1", status, ...extra }] });
const done = (url: string) => task("succeed", { outputs: [{ type: "image", url }] });

describe("Kling try-on client (Virtual Try-on 3.0: pictures by link, one task, polled on /solutions)", () => {
  const env = { ...process.env };
  let mockDir: string;
  beforeEach(async () => {
    mockDir = await mkdtemp(path.join(os.tmpdir(), "fc-kling-"));
    process.env.MOCK_S3 = "true"; process.env.MOCK_S3_DIR = mockDir; process.env.APP_URL = "https://closet.example";
    process.env.KLING_ACCESS_KEY = "ak-test"; process.env.KLING_SECRET_KEY = "sk-test"; process.env.KLING_POLL_MS = "5";
    delete process.env.MOCK_KLING; delete process.env.KLING_API_BASE; delete process.env.KLING_TIMEOUT_MS; delete process.env.KLING_API_KEY;
  });
  afterEach(() => { process.env = { ...env }; });
  const leftovers = async () => readdir(path.join(mockDir, "tryon", PERSON)).catch(() => [] as string[]);

  it("an API key from the Kling console goes as it is; with the key pair too, the API key wins; neither means not set up", async () => {
    expect(klingAuth({ KLING_API_KEY: "key-123" })).toBe("Bearer key-123");
    expect(klingAuth({ KLING_API_KEY: "key-123", KLING_ACCESS_KEY: "ak", KLING_SECRET_KEY: "sk" })).toBe("Bearer key-123");
    expect(klingAuth({ KLING_ACCESS_KEY: "ak", KLING_SECRET_KEY: "sk" })).toMatch(/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(klingAuth({})).toBeNull();
    delete process.env.KLING_ACCESS_KEY; delete process.env.KLING_SECRET_KEY;
    expect(isKlingConfigured()).toBe(false);
    process.env.KLING_API_KEY = "key-123";
    expect(isKlingConfigured()).toBe(true);
    const calls: Call[] = [];
    const out = await klingTryOn(await jpeg(), await jpeg(), PERSON, fakeKling([done("https://cdn.example/pic.png")], calls));
    expect(out.mimeType).toBe("image/png");
    expect(calls[0].headers.Authorization).toBe("Bearer key-123");
  });

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

  it("puts both pictures in the bucket as links, creates the task with face, pose and background kept, polls /solutions until it succeeds, fetches the picture, and removes the two objects", async () => {
    const calls: Call[] = [];
    const out = await klingTryOn(await jpeg(), await jpeg(), PERSON, fakeKling([task("submitted"), task("processing"), done("https://cdn.kling.example/out.png")], calls));
    expect(out.data.equals(picture)).toBe(true);
    expect(out.mimeType).toBe("image/png");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://api-singapore.klingai.com/solutions/virtual_try_on");
    expect(calls[0].headers.Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    const body = calls[0].body as { contents: { type: string; url: string }[]; settings: Record<string, boolean>; options: { watermark: { enabled: boolean } } };
    expect(body.contents.map((c) => c.type).sort()).toEqual(["person_image", "product_image"]);
    for (const c of body.contents) expect(c.url).toMatch(new RegExp(`^https://closet\\.example/api/photo/tryon/${PERSON}/[A-Za-z0-9]+\\.jpg$`)); // a link, never the bytes
    expect(body.settings).toEqual({ keep_face: true, keep_pose: true, keep_background: true });
    expect(body.options).toEqual({ watermark: { enabled: false } });
    expect(body).not.toHaveProperty("model_name");
    expect(calls.filter((c) => c.url === `${klingBase()}/solutions?task_ids=task-1` && c.method === "GET").length).toBe(3);
    expect(calls.at(-1)!.url).toBe("https://cdn.kling.example/out.png");
    expect(await leftovers()).toEqual([]); // the two objects are gone once Kling has answered
  });

  it("KLING_API_BASE passes through", async () => {
    process.env.KLING_API_BASE = "https://api-beijing.klingai.com/";
    const calls: Call[] = [];
    await klingTryOn(await jpeg(), await jpeg(), PERSON, fakeKling([done("https://cdn.kling.example/a.jpg")], calls));
    expect(calls[0].url).toBe("https://api-beijing.klingai.com/solutions/virtual_try_on");
    expect(calls[1].url).toBe("https://api-beijing.klingai.com/solutions?task_ids=task-1");
  });

  it("the pictures meet Kling's rules: a JPEG on white, longest side at most 2048, shortest over 300", async () => {
    const small = await sharp(await klingPicture(await jpeg(24, 32))).metadata();
    expect(small.format).toBe("jpeg");
    expect(Math.min(small.width!, small.height!)).toBeGreaterThan(300);
    const big = await sharp(await klingPicture(await sharp({ create: { width: 3000, height: 4500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer())).metadata();
    expect(Math.max(big.width!, big.height!)).toBeLessThanOrEqual(2048);
    expect(big.channels).toBe(3); // the transparency is flattened onto white
  });

  it("failures say what happened: refused keys, no credits, the filters, a retired API, a failed task, a task that never finishes, no keys at all; the objects are removed each time", async () => {
    const calls: Call[] = [];
    const reply = (code: number, message: string) => new Response(JSON.stringify({ code, message, request_id: "r" }), { status: 200 });
    await expect(klingTryOn(await jpeg(), await jpeg(), PERSON, fakeKling([], calls, { create: reply(1000, "auth failed") }))).rejects.toMatchObject({ code: "key", status: 503 });
    await expect(klingTryOn(await jpeg(), await jpeg(), PERSON, fakeKling([], calls, { create: new Response("nope", { status: 401 }) }))).rejects.toMatchObject({ code: "key" });
    await expect(klingTryOn(await jpeg(), await jpeg(), PERSON, fakeKling([], calls, { create: reply(1102, "insufficient balance") }))).rejects.toMatchObject({ code: "credits" });
    await expect(klingTryOn(await jpeg(), await jpeg(), PERSON, fakeKling([], calls, { create: reply(1301, "trigger strategy") }))).rejects.toMatchObject({ code: "moderation", status: 422 });
    await expect(klingTryOn(await jpeg(), await jpeg(), PERSON, fakeKling([], calls, { create: new Response(JSON.stringify({ code: 1203, message: "This API is no longer available. Please refer to the API documentation." }), { status: 404 }) }))).rejects.toMatchObject({ code: "gone" });
    await expect(klingTryOn(await jpeg(), await jpeg(), PERSON, fakeKling([task("failed", { message: "no human detected" })], calls))).rejects.toThrow(/full-body photo/);
    process.env.KLING_TIMEOUT_MS = "20";
    await expect(klingTryOn(await jpeg(), await jpeg(), PERSON, fakeKling([task("processing")], calls))).rejects.toMatchObject({ code: "timeout", status: 504 });
    expect(await leftovers()).toEqual([]);
    delete process.env.KLING_ACCESS_KEY;
    await expect(klingTryOn(await jpeg(), await jpeg(), PERSON, fakeKling([], calls))).rejects.toMatchObject({ code: "no_key", status: 503 });
  });

  it("the mock pastes the garment on with its own tint and never calls out", async () => {
    process.env.MOCK_KLING = "true";
    const calls: Call[] = [];
    const out = await klingTryOn(await jpeg(), await jpeg(), PERSON, fakeKling([], calls));
    expect(calls).toHaveLength(0);
    expect(out.mimeType).toBe("image/jpeg");
    const meta = await sharp(out.data).metadata();
    expect([meta.width, meta.height]).toEqual([600, 800]);
    expect((await mockKling(await jpeg(), await jpeg())).length).toBeGreaterThan(0);
    expect(await leftovers()).toEqual([]);
  });
});

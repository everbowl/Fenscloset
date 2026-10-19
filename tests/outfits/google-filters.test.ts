import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { googleTryOn } from "@/lib/tryon/google";
import { googleImage } from "@/lib/images/smooth";

/**
 * Google's visual filters (Jeff, 19 Oct 2026: none on his own body pictures). The loosest level is sent first; when Google
 * refuses it (400: the project is not on the allowlist) the next level down is sent, and the first one Google accepts wins.
 * A fake service account and a fake fetch stand in for Google.
 */
const png = Buffer.from("iVBORw0KGgo=", "base64");

type Call = { url: string; body: Record<string, unknown> };
function fakeGoogle(refuse: (body: Record<string, unknown>) => boolean, calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url, body });
    if (refuse(body)) return new Response(JSON.stringify({ error: { message: "safety setting not allowed" } }), { status: 400 });
    if (url.includes(":predict")) return new Response(JSON.stringify({ predictions: [{ bytesBase64Encoded: png.toString("base64"), mimeType: "image/png" }] }), { status: 200 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }] }), { status: 200 });
  }) as typeof fetch;
}

describe("Google visual filters: loosest first, step down on refusal", () => {
  const env = { ...process.env };
  beforeEach(() => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "t@example.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
    process.env.GOOGLE_VERTEX_PROJECT = "fens-closet-test";
    delete process.env.GOOGLE_VERTEX_TRYON_SAFETY; delete process.env.GOOGLE_VERTEX_IMAGE_SAFETY; delete process.env.MOCK_SMOOTH;
  });
  afterEach(() => { process.env = { ...env }; });

  it("try-on: block_none first; when refused, block_only_high", async () => {
    const calls: Call[] = [];
    const out = await googleTryOn(png, png, fakeGoogle((b) => (b.parameters as { safetySetting: string }).safetySetting === "block_none", calls));
    expect(out.data.length).toBeGreaterThan(0);
    expect(calls.map((c) => (c.body.parameters as { safetySetting: string }).safetySetting)).toEqual(["block_none", "block_only_high"]);
    expect((calls[0].body.parameters as { personGeneration: string }).personGeneration).toBe("allow_adult");
    // an allowlisted project: block_none is accepted on the first try
    const ok: Call[] = [];
    await googleTryOn(png, png, fakeGoogle(() => false, ok));
    expect(ok.map((c) => (c.body.parameters as { safetySetting: string }).safetySetting)).toEqual(["block_none"]);
    // a pinned level is sent first
    process.env.GOOGLE_VERTEX_TRYON_SAFETY = "block_only_high";
    const pinned: Call[] = [];
    await googleTryOn(png, png, fakeGoogle(() => false, pinned));
    expect(pinned.map((c) => (c.body.parameters as { safetySetting: string }).safetySetting)).toEqual(["block_only_high"]);
  });

  it("image model: relaxed goes OFF → BLOCK_NONE → BLOCK_ONLY_HIGH → defaults; not relaxed sends nothing", async () => {
    const level = (b: Record<string, unknown>) => (b.safetySettings as { threshold: string }[] | undefined)?.[0]?.threshold ?? null;
    const calls: Call[] = [];
    await googleImage([{ data: png, mimeType: "image/png" }], "x", fakeGoogle((b) => level(b) === "OFF" || level(b) === "BLOCK_NONE", calls), { relaxed: true });
    expect(calls.map((c) => level(c.body))).toEqual(["OFF", "BLOCK_NONE", "BLOCK_ONLY_HIGH"]);
    expect((calls[2].body.safetySettings as unknown[]).length).toBe(4); // every harm category
    const plain: Call[] = [];
    await googleImage([{ data: png, mimeType: "image/png" }], "x", fakeGoogle(() => false, plain));
    expect(plain.map((c) => level(c.body))).toEqual([null]); // a minor's look, the mannequin, a garment photo: Google's defaults
    // everything refused: the last try is Google's defaults; if that fails too the error says so
    const all: Call[] = [];
    await expect(googleImage([{ data: png, mimeType: "image/png" }], "x", fakeGoogle(() => true, all), { relaxed: true })).rejects.toThrow(/Google image 400/);
    expect(all.map((c) => level(c.body))).toEqual(["OFF", "BLOCK_NONE", "BLOCK_ONLY_HIGH", null]);
  });
});

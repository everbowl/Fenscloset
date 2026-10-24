import sharp from "sharp";

export class RemoveBgError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RemoveBgError";
  }
}

const ENDPOINT = "https://api.remove.bg/v1.0/removebg";

/**
 * Cuts the background out of a product/hanger photo. Returns a PNG with transparency.
 * MOCK_AI=true returns the input re-encoded as PNG (MOCK_REMOVE_BG_FAIL=<code> simulates an API error).
 */
export async function removeBackground(input: Buffer): Promise<Buffer> {
  if (process.env.MOCK_AI === "true") {
    if (process.env.MOCK_REMOVE_BG_FAIL) throw new RemoveBgError(process.env.MOCK_REMOVE_BG_FAIL, "Mock remove.bg failure");
    return sharp(input).png().toBuffer();
  }
  const apiKey = process.env.REMOVE_BG_API_KEY;
  if (!apiKey) throw new RemoveBgError("no_key", "REMOVE_BG_API_KEY is not set");
  const form = new FormData();
  form.append("image_file", new Blob([new Uint8Array(input)], { type: "image/jpeg" }), "photo.jpg");
  form.append("size", "auto");
  form.append("format", "png");
  form.append("type", "product");
  let res: Response;
  try {
    res = await fetch(ENDPOINT, { method: "POST", headers: { "X-Api-Key": apiKey }, body: form });
  } catch (e) {
    throw new RemoveBgError("network", (e as Error).message);
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = res.statusText;
    try {
      const body = (await res.json()) as { errors?: { code?: string; title?: string }[] };
      if (body.errors?.[0]) { code = body.errors[0].code ?? code; message = body.errors[0].title ?? message; }
    } catch { /* not json */ }
    throw new RemoveBgError(code, message);
  }
  return Buffer.from(await res.arrayBuffer());
}

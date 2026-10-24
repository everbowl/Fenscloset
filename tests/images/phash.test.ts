import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { hamming, phash } from "@/lib/images/phash";
import { makeThumb, normalizeOriginal, imageSize } from "@/lib/images/thumb";

async function img(w: number, h: number, color: { r: number; g: number; b: number }, stripe = false) {
  const base = sharp({ create: { width: w, height: h, channels: 3, background: color } });
  if (!stripe) return base.jpeg().toBuffer();
  const bar = await sharp({ create: { width: w, height: Math.floor(h / 2), channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  return base.composite([{ input: bar, top: 0, left: 0 }]).jpeg().toBuffer();
}

describe("perceptual hash", () => {
  it("is stable for the same image and differs for a different one", async () => {
    const a = await img(200, 300, { r: 20, g: 20, b: 20 }, true);
    const b = await img(200, 300, { r: 20, g: 20, b: 20 }, true);
    const c = await sharp(a).resize(120, 180).jpeg().toBuffer(); // same picture, smaller
    const d = await img(200, 300, { r: 20, g: 20, b: 20 }); // flat, no stripe
    const [ha, hb, hc, hd] = await Promise.all([phash(a), phash(b), phash(c), phash(d)]);
    expect(ha).toHaveLength(16);
    expect(ha).toBe(hb);
    expect(hamming(ha, hc)).toBeLessThanOrEqual(4);
    expect(hamming(ha, hd)).toBeGreaterThan(10);
    expect(hamming("0000000000000000", "ffffffffffffffff")).toBe(64);
  });

  it("normalizes and thumbs within bounds", async () => {
    const big = await img(2400, 1200, { r: 90, g: 90, b: 200 });
    const n = await normalizeOriginal(big);
    expect(await imageSize(n)).toEqual({ width: 1600, height: 800 });
    const t = await makeThumb(n, 400);
    expect(await imageSize(t)).toEqual({ width: 400, height: 200 });
  });
});

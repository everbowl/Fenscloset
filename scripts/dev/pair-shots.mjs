/** Dev-only: before/after pairs for the audit report. node scripts/dev/pair-shots.mjs <beforeDir> <afterDir> <outDir> name1 name2 ... */
import sharp from "sharp";
import { existsSync } from "node:fs";
import path from "node:path";
const [before, after, out, ...names] = process.argv.slice(2);
const W = 430, MAXH = 2600, GAP = 24, LABEL = 36;
const label = (text, w) => Buffer.from(`<svg width="${w}" height="${LABEL}"><rect width="100%" height="100%" fill="#111"/><text x="12" y="24" font-family="monospace" font-size="15" fill="#f2f0eb">${text}</text></svg>`);
const prep = async (file) => {
  if (!file || !existsSync(file)) return sharp({ create: { width: W, height: 200, channels: 3, background: "#ddd" } }).png().toBuffer();
  const img = sharp(file).resize({ width: W }); const meta = await img.metadata(); const m = await sharp(await img.toBuffer()).metadata();
  const h = Math.min(m.height, MAXH);
  return sharp(await img.toBuffer()).extract({ left: 0, top: 0, width: W, height: h }).png().toBuffer();
};
for (const name of names) {
  const b = await prep(path.join(before, `${name}.png`)); const a = await prep(path.join(after, `${name}.png`));
  const [bm, am] = await Promise.all([sharp(b).metadata(), sharp(a).metadata()]);
  const H = Math.max(bm.height, am.height) + LABEL;
  await sharp({ create: { width: W * 2 + GAP, height: H, channels: 3, background: "#ffffff" } })
    .composite([
      { input: label(`BEFORE · ${name}`, W), left: 0, top: 0 }, { input: b, left: 0, top: LABEL },
      { input: label(`AFTER · ${name}`, W), left: W + GAP, top: 0 }, { input: a, left: W + GAP, top: LABEL },
    ]).png().toFile(path.join(out, `pair-${name}.png`));
  console.log("pair", name, H);
}

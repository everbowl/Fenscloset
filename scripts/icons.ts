/** Generates the PWA icons from the brand mark (a door left ajar). Run: npx tsx scripts/icons.ts */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

// Mark from the brand sheet: viewBox 0 0 60 96, arch top, split door.
const mark = (fill: string) =>
  `<g fill="${fill}"><path d="M0 96V30a30 30 0 0 1 60 0v66z" clip-path="url(#c)"/></g>`;
const svg = (bg: string, fg: string, pad: number, radius: number) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><clipPath id="c"><rect x="0" y="0" width="36" height="96"/><rect x="39.5" y="0" width="20.5" height="96"/></clipPath></defs>
  <rect width="512" height="512" rx="${radius}" fill="${bg}"/>
  <g transform="translate(${256 - (60 * (512 - 2 * pad)) / 96 / 2}, ${pad}) scale(${(512 - 2 * pad) / 96})">${mark(fg)}</g>
</svg>`;

async function main() {
  mkdirSync("public/icons", { recursive: true });
  await sharp(Buffer.from(svg("#000000", "#ffffff", 136, 0))).resize(192, 192).png().toFile("public/icons/icon-192.png");
  await sharp(Buffer.from(svg("#000000", "#ffffff", 136, 0))).resize(512, 512).png().toFile("public/icons/icon-512.png");
  await sharp(Buffer.from(svg("#000000", "#ffffff", 168, 0))).resize(512, 512).png().toFile("public/icons/icon-512-maskable.png");
  await sharp(Buffer.from(svg("#000000", "#ffffff", 136, 0))).resize(180, 180).png().toFile("public/apple-touch-icon.png");
  await sharp(Buffer.from(svg("#000000", "#ffffff", 136, 0))).resize(64, 64).png().toFile("src/app/icon.png");
  console.log("icons written");
}
main();

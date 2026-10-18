/** Generates the PWA icons from an inline SVG. Run: npx tsx scripts/icons.ts */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const svg = (pad: number) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#b45309"/>
  <g transform="translate(${pad},${pad}) scale(${(512 - 2 * pad) / 512})">
    <path d="M256 96c-30 0-52 20-52 46 0 18 10 30 24 38l-96 54c-20 11-32 32-32 55v83c0 17 13 30 30 30h252c17 0 30-13 30-30v-83c0-23-12-44-32-55l-96-54c14-8 24-20 24-38 0-26-22-46-52-46zm0 40c10 0 16 5 16 12s-6 12-16 12-16-5-16-12 6-12 16-12z" fill="#fff7ed"/>
  </g>
</svg>`;

mkdirSync("public/icons", { recursive: true });
async function main() {
await sharp(Buffer.from(svg(0))).resize(192, 192).png().toFile("public/icons/icon-192.png");
await sharp(Buffer.from(svg(0))).resize(512, 512).png().toFile("public/icons/icon-512.png");
await sharp(Buffer.from(svg(64))).resize(512, 512).png().toFile("public/icons/icon-512-maskable.png");
await sharp(Buffer.from(svg(0))).resize(180, 180).png().toFile("public/apple-touch-icon.png");
await sharp(Buffer.from(svg(0))).resize(64, 64).png().toFile("src/app/icon.png");
console.log("icons written");
}
main();

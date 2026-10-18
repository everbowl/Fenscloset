/** e2e helper: a small clean closet (top, bottom, shoes, outerwear) for each named person, plus a stale piece for Jeff. */
import "dotenv/config";
import sharp from "sharp";
import { db } from "../src/lib/db";
import { newKey, putObject } from "../src/lib/storage";
import { personalClosetId } from "../src/lib/items/service";

async function main() {
  const names = process.argv.slice(2);
  const cats = Object.fromEntries((await db.category.findMany()).map((c) => [c.name, c.id]));
  for (const name of names) {
    const person = await db.person.findFirstOrThrow({ where: { name } });
    const closetId = await personalClosetId(person.id);
    const specs = [
      { name: `${name} white tee`, cat: "Tops", rgb: { r: 240, g: 240, b: 240 } },
      { name: `${name} black tee`, cat: "Tops", rgb: { r: 30, g: 30, b: 30 } },
      { name: `${name} dark jeans`, cat: "Bottoms", rgb: { r: 30, g: 40, b: 80 } },
      { name: `${name} sneakers`, cat: "Shoes", rgb: { r: 200, g: 200, b: 190 } },
      { name: `${name} linen blazer`, cat: "Outerwear", rgb: { r: 210, g: 190, b: 160 } },
    ];
    for (const s of specs) {
      const thumb = newKey("thumbs", person.id, "image/jpeg");
      const buf = await sharp({ create: { width: 400, height: 400, channels: 3, background: s.rgb } }).jpeg().toBuffer();
      await putObject(thumb, buf, "image/jpeg");
      await db.item.create({ data: { ownerId: person.id, name: s.name, categoryId: cats[s.cat], closets: { create: [{ closetId }] }, photos: { create: [{ kind: "thumb", bucketKey: thumb }] } } });
    }
    if (name === "Brittney") await db.person.update({ where: { id: person.id }, data: { email: "brittney@example.com" } });
    if (name === "Jeff") {
      await db.item.create({ data: { ownerId: person.id, name: "Old parka", categoryId: cats.Outerwear, createdAt: new Date(Date.now() - 400 * 86400000), closets: { create: [{ closetId }] } } });
    }
  }
  console.log("seeded closets");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

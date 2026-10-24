/** e2e helper: two items for Jeff with real thumbnails in the mock bucket. */
import "dotenv/config";
import sharp from "sharp";
import { db } from "../src/lib/db";
import { newKey, putObject } from "../src/lib/storage";
import { personalClosetId } from "../src/lib/items/service";

async function main() {
  const jeff = await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } });
  const closetId = await personalClosetId(jeff.id);
  const cat = async (n: string) => (await db.category.findFirstOrThrow({ where: { name: n } })).id;
  const brand = async (n: string) => (await db.brand.findFirstOrThrow({ where: { name: n } })).id;
  const specs = [
    { name: "White crew tee", categoryId: await cat("Tops"), rgb: { r: 240, g: 240, b: 240 } },
    { name: "Dark jeans", categoryId: await cat("Bottoms"), brandId: await brand("Levi's"), rgb: { r: 30, g: 40, b: 80 } },
  ];
  for (const s of specs) {
    const thumb = newKey("thumbs", jeff.id, "image/jpeg");
    const original = newKey("originals", jeff.id, "image/jpeg");
    const buf = await sharp({ create: { width: 400, height: 400, channels: 3, background: s.rgb } }).jpeg().toBuffer();
    await putObject(thumb, buf, "image/jpeg");
    await putObject(original, buf, "image/jpeg");
    await db.item.create({ data: { ownerId: jeff.id, name: s.name, categoryId: s.categoryId, brandId: s.brandId, closets: { create: [{ closetId }] }, photos: { create: [{ kind: "alone", bucketKey: original, isPrimary: true }, { kind: "thumb", bucketKey: thumb }] } } });
  }
  console.log("seeded items");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

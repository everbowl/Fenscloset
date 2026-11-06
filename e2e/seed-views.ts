/** e2e helper: five tagged pieces for Jeff (colors, seasons, brands, wear, laundry, prices) to sort and filter; Dark jeans is in the Family closet too. */
import "dotenv/config";
import sharp from "sharp";
import { db } from "../src/lib/db";
import { newKey, putObject } from "../src/lib/storage";
import { personalClosetId } from "../src/lib/items/service";

const day = 86400000;
const ago = (d: number) => new Date(Date.now() - d * day);

async function main() {
  const jeff = await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } });
  const mine = await personalClosetId(jeff.id);
  const family = (await db.closet.findFirstOrThrow({ where: { kind: "family" } })).id;
  const one = async (find: Promise<{ id: string }>) => ({ id: (await find).id });
  const cat = (n: string) => db.category.findFirstOrThrow({ where: { name: n } });
  const color = (n: string) => one(db.color.findUniqueOrThrow({ where: { name: n } }));
  const season = (n: string) => one(db.season.findUniqueOrThrow({ where: { name: n } }));
  const brand = (n: string) => db.brand.findUniqueOrThrow({ where: { name: n } });
  const occasion = (n: string) => one(db.occasion.findUniqueOrThrow({ where: { name: n } }));
  const formality = (n: string) => one(db.formalityLevel.findUniqueOrThrow({ where: { name: n } }));
  const tag = (n: string) => one(db.tag.findUniqueOrThrow({ where: { name: n } }));
  const specs = [
    { name: "Black crew tee", cat: "Tops", rgb: { r: 30, g: 30, b: 30 }, colors: ["Black"], seasons: ["Summer"], brand: "Uniqlo", occasions: ["Everyday"], formalities: ["Casual"], isFavorite: true, wearCount: 5, lastWornAt: ago(2), purchasePrice: 25, createdAt: ago(30) },
    { name: "Black hoodie", cat: "Tops", rgb: { r: 40, g: 40, b: 40 }, colors: ["Black"], seasons: ["Fall", "Winter"], brand: "Nike", tags: ["Comfy"], laundryStatus: "dirty" as const, wearCount: 2, lastWornAt: ago(30), purchasePrice: 60, createdAt: ago(10) },
    { name: "White linen shirt", cat: "Tops", rgb: { r: 245, g: 245, b: 240 }, colors: ["White"], seasons: ["Summer"], brand: "J.Crew", occasions: ["Dinner out"], formalities: ["Smart casual"], wearCount: 0, purchasePrice: 90, createdAt: ago(5) },
    { name: "Dark jeans", cat: "Bottoms", rgb: { r: 30, g: 40, b: 80 }, colors: ["Navy"], seasons: ["Spring", "Summer", "Fall", "Winter"], brand: "Levi's", wearCount: 12, lastWornAt: ago(1), purchasePrice: 70, createdAt: ago(100), family: true },
    { name: "Running shorts", cat: "Bottoms", rgb: { r: 20, g: 20, b: 20 }, colors: ["Black"], seasons: ["Summer"], brand: "Nike", occasions: ["Gym"], laundryStatus: "cleaners" as const, wearCount: 3, lastWornAt: ago(10), createdAt: ago(20) },
  ];
  for (const s of specs) {
    const thumb = newKey("thumbs", jeff.id, "image/jpeg");
    const buf = await sharp({ create: { width: 400, height: 400, channels: 3, background: s.rgb } }).jpeg().toBuffer();
    await putObject(thumb, buf, "image/jpeg");
    await db.item.create({
      data: {
        ownerId: jeff.id, name: s.name, categoryId: (await cat(s.cat)).id, brandId: (await brand(s.brand)).id,
        colors: { connect: await Promise.all(s.colors.map(color)) }, seasons: { connect: await Promise.all(s.seasons.map(season)) },
        occasions: { connect: await Promise.all((s.occasions ?? []).map(occasion)) }, formalities: { connect: await Promise.all((s.formalities ?? []).map(formality)) },
        tags: { connect: await Promise.all((s.tags ?? []).map(tag)) },
        isFavorite: s.isFavorite ?? false, laundryStatus: s.laundryStatus ?? "clean", wearCount: s.wearCount, lastWornAt: s.lastWornAt ?? null, purchasePrice: s.purchasePrice ?? null, createdAt: s.createdAt,
        closets: { create: [{ closetId: mine }, ...(s.family ? [{ closetId: family }] : [])] },
        photos: { create: [{ kind: "thumb", bucketKey: thumb }] },
      },
    });
  }
  console.log("seeded views");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

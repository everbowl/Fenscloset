/** e2e helper: make brands someone's favorites, e.g. `npx tsx e2e/seed-brands.ts Jeff Everlane Vuori` (brands are created when missing). */
import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  const [name, ...brands] = process.argv.slice(2);
  if (!name || !brands.length) { console.error("usage: seed-brands.ts <first name> <brand> [brand…]"); process.exit(1); }
  const person = await db.person.findFirstOrThrow({ where: { name } });
  const ids: { id: string }[] = [];
  for (const b of brands) ids.push(await db.brand.upsert({ where: { name: b }, update: { isArchived: false }, create: { name: b }, select: { id: true } }));
  await db.person.update({ where: { id: person.id }, data: { favoriteBrands: { set: ids } } });
  console.log(`${name}: ${brands.join(", ")}`);
}

main().then(() => db.$disconnect()).catch((e) => { console.error(e); process.exit(1); });

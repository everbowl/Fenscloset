/** e2e helper: give one seeded piece a color, e.g. `npx tsx e2e/seed-color.ts "Jeff linen blazer" "beige|cream|tan|oat"` (a regex over color names). */
import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  const [name, colorWord] = process.argv.slice(2);
  if (!name || !colorWord) { console.error("usage: seed-color.ts <item name> <color word>"); process.exit(1); }
  const item = await db.item.findFirstOrThrow({ where: { name } });
  const colors = await db.color.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" } });
  const color = colors.find((c) => new RegExp(colorWord, "i").test(c.name)) ?? colors[0];
  await db.item.update({ where: { id: item.id }, data: { colors: { connect: [{ id: color.id }] } } });
  console.log(`${name}: ${color.name}`);
}

main().then(() => db.$disconnect()).catch((e) => { console.error(e); process.exit(1); });

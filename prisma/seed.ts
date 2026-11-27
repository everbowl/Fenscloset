import "dotenv/config";
import { db } from "../src/lib/db";
import { BRAND_CATALOG } from "../src/lib/brands/catalog";
import {
  BRANDS, CATEGORIES, CHECK_IN_SCALES, COLORS, FABRICS, FORMALITY, MEASUREMENT_KINDS, OCCASIONS,
  PATTERNS, RULES, SEASONS, SIZE_OPTIONS, STORES, STYLE_WORDS, TAGS, PHOTO_TIPS, MIRROR_POSES, WEAR_GROUPS } from "./seed-data";

type SimpleDelegate = {
  upsert: (args: { where: { name: string }; update: object; create: { name: string; sortOrder: number } }) => Promise<unknown>;
};

async function seedSimple(delegate: SimpleDelegate, names: string[]) {
  for (const [i, name] of names.entries()) {
    await delegate.upsert({ where: { name }, update: {}, create: { name, sortOrder: i } });
  }
}

/**
 * Seeds defaults. Runs on every deploy, so it only acts on an EMPTY database: once people exist,
 * admins own every list and the seed must never re-create something they deleted or renamed.
 * Set SEED_FORCE=true to re-run the upserts on purpose (local dev / tests).
 */
/** The parts of a store a person shops in. Each person picks theirs on the Shop page. */
const SHOP_SECTIONS = ["Men's", "Women's", "Boys'", "Girls'", "Unisex"];

export async function seed() {
  // Rules are keyed settings, not admin-owned list rows: a new rule must appear after a deploy, so they are
  // always upserted (values an admin changed are kept; only label/description refresh).
  for (const r of RULES) {
    await db.rule.upsert({ where: { key: r.key }, update: { label: r.label, description: r.description }, create: r });
  }
  // A rule that left the code leaves the page (the Tidy and Smooth switch, 19 Oct 2026); rules are code-defined keys, never admin-made.
  await db.rule.deleteMany({ where: { key: { notIn: RULES.map((r) => r.key) } } });
  if ((await db.person.count()) > 0 && process.env.SEED_FORCE !== "true") {
    const ran = await applySeedSets();
    console.log(ran.length ? `Seed: people exist; applied new sets ${ran.join(", ")}.` : "Seed skipped: database already has people.");
    return;
  }

  // No people: the repository holds no one's name or address (security item 1). Tests and e2e specs add the synthetic
  // household from tests/fixtures/people.ts. A fresh environment's first admin comes from FC_BOOTSTRAP_ADMIN_EMAIL, read
  // only while the database has no people (security item 3): that person is created as an admin with no password and sets
  // one through Forgot password; afterwards the variable does nothing and the owner deletes it. Unset, nobody is created.
  const family = await db.closet.findFirst({ where: { kind: "family" } });
  if (!family) await db.closet.create({ data: { name: "Family", kind: "family", sortOrder: 100 } });
  const bootstrap = process.env.FC_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (bootstrap && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bootstrap)) {
    const admin = await db.person.create({ data: { name: bootstrap.split("@")[0], email: bootstrap, role: "admin", status: "invited" } });
    await db.closet.create({ data: { name: `${admin.name}'s closet`, kind: "personal", ownerId: admin.id } });
    console.log("Seed: first admin created from FC_BOOTSTRAP_ADMIN_EMAIL — use Forgot password on the sign-in page, then delete the variable.");
  }

  // Categories + subcategories
  let ci = 0;
  for (const [name, subs] of Object.entries(CATEGORIES)) {
    const cat = await db.category.upsert({ where: { name }, update: {}, create: { name, sortOrder: ci++, photoTip: PHOTO_TIPS[name] ?? null } });
    if (!cat.photoTip && PHOTO_TIPS[name]) await db.category.update({ where: { id: cat.id }, data: { photoTip: PHOTO_TIPS[name] } });
    for (const [si, sub] of subs.entries()) {
      await db.subcategory.upsert({
        where: { categoryId_name: { categoryId: cat.id, name: sub } },
        update: {},
        create: { categoryId: cat.id, name: sub, sortOrder: si },
      });
    }
  }

  await seedSizeOptions();

  for (const [i, c] of COLORS.entries()) {
    await db.color.upsert({ where: { name: c.name }, update: {}, create: { name: c.name, hex: c.hex, sortOrder: i } });
  }
  await seedSimple(db.pattern, PATTERNS);
  await seedSimple(db.fabric, FABRICS);
  await seedSimple(db.season, SEASONS);
  await seedSimple(db.formalityLevel, FORMALITY);
  await seedSimple(db.occasion, OCCASIONS);
  await seedSimple(db.tag, TAGS);
  await seedSimple(db.brand, BRANDS);
  await seedSimple(db.store, STORES);
  await seedSimple(db.styleWord, STYLE_WORDS);
  await seedSimple(db.shopSection, SHOP_SECTIONS);
  await seedMeasurementKinds();

  let si = 0;
  for (const [name, options] of Object.entries(CHECK_IN_SCALES)) {
    const scale = await db.checkInScale.upsert({ where: { name }, update: {}, create: { name, sortOrder: si++ } });
    for (const [oi, opt] of options.entries()) {
      await db.checkInOption.upsert({
        where: { scaleId_name: { scaleId: scale.id, name: opt } },
        update: {},
        create: { scaleId: scale.id, name: opt, sortOrder: oi },
      });
    }
  }

  // A fresh database gets the sets that only live as sets (the brand catalog, the mirror's styling lists), then every set is marked applied.
  await SEED_SETS["brands-catalog-v1"]();
  await SEED_SETS["mirror-styling-v1"]();
  for (const name of Object.keys(SEED_SETS)) await db.seedSet.upsert({ where: { name }, update: {}, create: { name } });
  if (!bootstrap) console.log("Seed: lists, rules and the Family closet are in; no people — set FC_BOOTSTRAP_ADMIN_EMAIL or run npm run admin:bootstrap for the first admin (README).");
}

async function seedSizeOptions() {
  for (const [catName, sizes] of Object.entries(SIZE_OPTIONS)) {
    const cat = await db.category.findUnique({ where: { name: catName } });
    if (!cat) continue;
    for (const [si, name] of sizes.entries()) {
      await db.sizeOption.upsert({ where: { categoryId_name: { categoryId: cat.id, name } }, update: {}, create: { categoryId: cat.id, name, sortOrder: si } });
    }
  }
}

async function seedMeasurementKinds() {
  for (const [i, m] of MEASUREMENT_KINDS.entries()) {
    await db.measurementKind.upsert({ where: { name: m.name }, update: { sortOrder: i }, create: { name: m.name, unit: m.unit, sortOrder: i } });
  }
}

/** The mirror's poses and "how clothes show" groups (first entry = default). Existing rows keep whatever an admin made of them. */
async function seedMirrorStyling() {
  for (const [i, p] of MIRROR_POSES.entries()) await db.mirrorPose.upsert({ where: { name: p.name }, update: {}, create: { name: p.name, prompt: p.prompt, sortOrder: i } });
  for (const [gi, g] of WEAR_GROUPS.entries()) {
    const group = await db.wearGroup.upsert({ where: { name: g.name }, update: {}, create: { name: g.name, needs: g.needs, sortOrder: gi } });
    for (const [oi, o] of g.options.entries()) await db.wearOption.upsert({ where: { groupId_name: { groupId: group.id, name: o.name } }, update: {}, create: { groupId: group.id, name: o.name, prompt: o.prompt, sortOrder: oi } });
  }
}

async function seedPhotoTips() {
  for (const [name, tip] of Object.entries(PHOTO_TIPS)) {
    const cat = await db.category.findUnique({ where: { name } });
    if (cat && !cat.photoTip) await db.category.update({ where: { id: cat.id }, data: { photoTip: tip } });
  }
}

/**
 * Additive sets, each applied ONCE per database (SeedSet rows). Bump a set's name (…-v2) when its
 * contents grow, so a database that already has people gets the new rows on the next deploy, while
 * anything an admin deleted or renamed after that stays as they left it.
 */
const SEED_SETS: Record<string, () => Promise<void>> = {
  "size-options-v1": seedSizeOptions,
  "measurement-kinds-v2": seedMeasurementKinds,
  "photo-tips-v1": seedPhotoTips,
  "style-words-v1": () => seedSimple(db.styleWord, STYLE_WORDS),
  // Shop sections (2 Nov 2026: the Shop mixed men's and women's). Everyone picks theirs on the Shop.
  "shop-sections-v1": () => seedSimple(db.shopSection, SHOP_SECTIONS),
  "brands-v1": () => seedSimple(db.brand, BRANDS),
  "stores-v1": () => seedSimple(db.store, STORES),
  // The national brand catalog lands in the Brands list (owner, 19 Oct 2026: "brands didn't auto populate"), each with its store link.
  "brands-catalog-v1": async () => {
    const have = new Set((await db.brand.findMany({ select: { name: true } })).map((b) => b.name.toLowerCase()));
    let order = (await db.brand.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    for (const b of BRAND_CATALOG) {
      if (have.has(b.name.toLowerCase())) continue;
      await db.brand.create({ data: { name: b.name, url: `https://www.${b.domain}`, sortOrder: ++order } });
      have.add(b.name.toLowerCase());
    }
  },
  // The mirror's styling chips (owner, 19 Oct 2026): poses and "how clothes show", untucked first.
  "mirror-styling-v1": seedMirrorStyling,
  // Shoes: plain numbers become "M 10 / W 11.5" (owner, 19 Oct 2026); only untouched numeric options are swapped.
  "shoe-sizes-v2": async () => {
    const shoes = await db.category.findUnique({ where: { name: "Shoes" } });
    if (!shoes) return;
    await db.sizeOption.deleteMany({ where: { categoryId: shoes.id, name: { in: Array.from({ length: 23 }, (_, i) => (4 + i / 2).toString()) } } });
    for (const [si, name] of SIZE_OPTIONS.Shoes.entries()) await db.sizeOption.upsert({ where: { categoryId_name: { categoryId: shoes.id, name } }, update: { sortOrder: si }, create: { categoryId: shoes.id, name, sortOrder: si } });
  },
};

export async function applySeedSets(): Promise<string[]> {
  const done = new Set((await db.seedSet.findMany()).map((r) => r.name));
  const ran: string[] = [];
  for (const [name, run] of Object.entries(SEED_SETS)) {
    if (done.has(name)) continue;
    await run();
    await db.seedSet.create({ data: { name } });
    ran.push(name);
  }
  return ran;
}

// Run directly: `npm run db:seed`
if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  seed()
    .then(async () => {
      console.log("Seed complete.");
      await db.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await db.$disconnect();
      process.exit(1);
    });
}

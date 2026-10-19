import "dotenv/config";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { BRAND_CATALOG } from "../src/lib/brands/catalog";
import { isDevMode } from "../src/lib/auth/dev-mode";
import {
  BODY_IMAGE_APPROVALS, BRANDS, CATEGORIES, CHECK_IN_SCALES, COLORS, DEV_PASSWORD, FABRICS, FORMALITY, MEASUREMENT_KINDS, OCCASIONS,
  PATTERNS, PEOPLE, RULES, SEASONS, SIZE_OPTIONS, STORES, STYLE_WORDS, TAGS, PHOTO_TIPS, MIRROR_POSES, WEAR_GROUPS } from "./seed-data";

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
export async function seed() {
  const devMode = isDevMode();
  // Rules are keyed settings, not admin-owned list rows: a new rule must appear after a deploy, so they are
  // always upserted (values an admin changed are kept; only label/description refresh).
  for (const r of RULES) {
    await db.rule.upsert({ where: { key: r.key }, update: { label: r.label, description: r.description }, create: r });
  }
  if ((await db.person.count()) > 0 && process.env.SEED_FORCE !== "true") {
    const ran = await applySeedSets();
    console.log(ran.length ? `Seed: people exist; applied new sets ${ran.join(", ")}.` : "Seed skipped: database already has people.");
    return;
  }

  // People
  const ids: Record<string, string> = {};
  for (const p of PEOPLE) {
    const existing = p.email
      ? await db.person.findUnique({ where: { email: p.email } })
      : await db.person.findFirst({ where: { name: p.name, email: null } });
    const person = existing
      ? await db.person.update({ where: { id: existing.id }, data: { role: p.role } })
      : await db.person.create({ data: { name: p.name, email: p.email, role: p.role, status: "invited" } });
    ids[p.key] = person.id;
  }

  // Jeff's DEV password: set only on first seed in DEV mode, and only if he has no password yet.
  const jeff = await db.person.findUniqueOrThrow({ where: { id: ids.jeff } });
  if (devMode && !jeff.passwordHash) {
    await db.person.update({
      where: { id: jeff.id },
      data: {
        passwordHash: await hashPassword(DEV_PASSWORD),
        mustChangePassword: true,
        devPasswordActive: true,
        status: "active",
      },
    });
  }

  // Guardians
  for (const p of PEOPLE) {
    for (const g of p.guardians ?? []) {
      await db.guardianLink.upsert({
        where: { minorId_parentId: { minorId: ids[p.key], parentId: ids[g] } },
        update: {},
        create: { minorId: ids[p.key], parentId: ids[g] },
      });
    }
  }

  // Closets: one personal per person + Family
  for (const p of PEOPLE) {
    const exists = await db.closet.findFirst({ where: { ownerId: ids[p.key], kind: "personal" } });
    if (!exists) await db.closet.create({ data: { name: `${p.name}'s closet`, kind: "personal", ownerId: ids[p.key] } });
  }
  const family = await db.closet.findFirst({ where: { kind: "family" } });
  if (!family) await db.closet.create({ data: { name: "Family", kind: "family", sortOrder: 100 } });

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
  await seedMeasurementKinds();
  for (const a of BODY_IMAGE_APPROVALS) {
    if (ids[a.minor] && ids[a.by]) await db.minorBodyImageApproval.upsert({ where: { minorId: ids[a.minor] }, update: {}, create: { minorId: ids[a.minor], approvedById: ids[a.by] } });
  }

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
  "brands-v1": () => seedSimple(db.brand, BRANDS),
  "stores-v1": () => seedSimple(db.store, STORES),
  // The national brand catalog lands in the Brands list (Jeff, 19 Oct 2026: "brands didn't auto populate"), each with its store link.
  "brands-catalog-v1": async () => {
    const have = new Set((await db.brand.findMany({ select: { name: true } })).map((b) => b.name.toLowerCase()));
    let order = (await db.brand.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    for (const b of BRAND_CATALOG) {
      if (have.has(b.name.toLowerCase())) continue;
      await db.brand.create({ data: { name: b.name, url: `https://www.${b.domain}`, sortOrder: ++order } });
      have.add(b.name.toLowerCase());
    }
  },
  // The mirror's styling chips (Jeff, 19 Oct 2026): poses and "how clothes show", untucked first.
  "mirror-styling-v1": seedMirrorStyling,
  // Shoes: plain numbers become "M 10 / W 11.5" (Jeff, 19 Oct 2026); only untouched numeric options are swapped.
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

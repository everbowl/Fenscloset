import "dotenv/config";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { isDevMode } from "../src/lib/auth/dev-mode";
import {
  BODY_IMAGE_APPROVALS, BRANDS, CATEGORIES, CHECK_IN_SCALES, COLORS, DEV_PASSWORD, FABRICS, FORMALITY, MEASUREMENT_KINDS, OCCASIONS,
  PATTERNS, PEOPLE, RULES, SEASONS, STORES, STYLE_WORDS, TAGS, PHOTO_TIPS } from "./seed-data";

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
    console.log("Seed skipped: database already has people.");
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
  for (const [i, m] of MEASUREMENT_KINDS.entries()) {
    await db.measurementKind.upsert({ where: { name: m.name }, update: {}, create: { name: m.name, unit: m.unit, sortOrder: i } });
  }
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

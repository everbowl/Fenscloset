import { db } from "@/lib/db";

/** Wipe every table so each test file starts clean. Order handles FKs via CASCADE. */
export async function resetDb() {
  const tables = [
    "ImportEntry", "ImportBatch", "ItemPhoto", "ItemShare", "ItemCloset", "Item", "Session", "PasswordResetToken", "InviteToken", "GuardianLink",
    "Closet", "Subcategory", "Category", "Color", "Pattern", "Fabric", "Season",
    "FormalityLevel", "Occasion", "Tag", "Brand", "Store", "CheckInOption", "CheckInScale",
    "Rule", "Person",
  ];
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
}

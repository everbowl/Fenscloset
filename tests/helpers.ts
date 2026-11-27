import { db } from "@/lib/db";
import { seed as seedDefaults } from "../prisma/seed";
import { seedPeople } from "./fixtures/people";

/** What the seed used to give every test: the default lists and rules plus a household. The household is synthetic now. */
export async function seed() {
  await seedDefaults();
  await seedPeople();
}

/** Wipe every table so each test file starts clean. Order handles FKs via CASCADE. */
export async function resetDb() {
  const tables = [
    "LookPiece", "Look", "Want", "BrandFeed", "GoWith", "ShoppingLookup", "LookFeedback", "InspirationLook", "TryOn", "DayPlan", "CheckInAnswer", "CheckIn", "FitViewer", "FitItem", "WearLog", "Fit", "OutfitSuggestion", "TogetherPerson", "TogetherSession", "GoogleCalendarConnection", "WeatherCache",
    "NeedSnooze", "BodyMeasurement", "BodySizeByBrand", "BodyPhoto", "BodyProfile", "BodyDataGrant", "ShopForGrant", "MinorBodyImageApproval", "MeasurementKind", "StyleWord",
    "ImportEntry", "ImportBatch", "ItemPhoto", "ItemShare", "ItemCloset", "Item", "Session", "PasswordResetToken", "InviteToken", "GuardianLink", "AuthAttempt",
    "Closet", "Subcategory", "Category", "Color", "Pattern", "Fabric", "Season",
    "FormalityLevel", "Occasion", "Tag", "Brand", "Store", "CheckInOption", "CheckInScale",
    "Rule", "Person", "MirrorPose", "WearOption", "WearGroup", "SeedSet",
  ];
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
}

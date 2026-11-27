/** e2e helper: the synthetic household on top of the seeded defaults (`npx tsx e2e/seed-people.ts`). */
import "dotenv/config";
import { db } from "../src/lib/db";
import { seedPeople } from "../tests/fixtures/people";

seedPeople().then(() => db.$disconnect()).catch((e) => { console.error(e); process.exit(1); });

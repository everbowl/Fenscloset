/**
 * Resets the owner's password to the one-time DEV password (DEV_PASSWORD in seed-data). Only works while DEV_MODE=true.
 * Usage: npm run db:reset-dev-password
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { DEV_ADMIN_EMAIL, isDevMode } from "../src/lib/auth/dev-mode";
import { destroyAllSessionsFor } from "../src/lib/auth/session";
import { DEV_PASSWORD } from "../prisma/seed-data";

async function main() {
  if (!isDevMode()) throw new Error("Refusing: DEV_MODE is not 'true'. The one-time dev password only exists in DEV mode.");
  if (!DEV_ADMIN_EMAIL) throw new Error("Refusing: DEV_ADMIN_EMAIL is not set.");
  const admin = await db.person.findUniqueOrThrow({ where: { email: DEV_ADMIN_EMAIL } });
  await db.person.update({
    where: { id: admin.id },
    data: { passwordHash: await hashPassword(DEV_PASSWORD), mustChangePassword: true, devPasswordActive: true, devPasswordUsedAt: null, status: "active" },
  });
  await destroyAllSessionsFor(jeff.id);
  console.log(`[DEV-MODE] Password for ${DEV_ADMIN_EMAIL} reset to ${DEV_PASSWORD} (one login only).`);
}

main().finally(() => db.$disconnect());

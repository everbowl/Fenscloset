import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";

async function main() {
  const [email, password] = process.argv.slice(2);
  await db.person.update({ where: { email }, data: { passwordHash: await hashPassword(password), mustChangePassword: false, devPasswordActive: false, status: "active" } });
  await db.$disconnect();
}
main();

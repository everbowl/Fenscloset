/**
 * The first admin of a database that has none: `npm run admin:bootstrap -- --email <address> [--print]`.
 * E-mails a single-use, 60-minute reset link; with --print it prints the link once instead (for a machine without mail).
 * Refuses while an admin with a password exists (security item 3).
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { bootstrapAdmin } from "../src/lib/auth/bootstrap";

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--email");
  const email = at >= 0 ? args[at + 1] : undefined;
  if (!email) { console.error("usage: npm run admin:bootstrap -- --email <address> [--print]"); process.exit(2); }
  const r = await bootstrapAdmin(email, { print: args.includes("--print") });
  if (!r.ok) { console.error(`Refused: ${r.reason}.`); process.exit(1); }
  if (r.link) console.log(`Open this link within 60 minutes to choose a password (it works once):\n${r.link}`);
  else console.log("A reset link was e-mailed to that address. It works once and expires in 60 minutes.");
}

main().then(() => db.$disconnect()).catch((e) => { console.error(e); process.exit(1); });

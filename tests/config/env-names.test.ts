import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Security item 12 (PF-06): every variable the app reads is documented by name in `.env.example` and in the README's table,
 * and nothing documented is dead. Names only; no value is read here. Platform and test-only names are allowed by prefix.
 */
const ROOT = path.resolve(__dirname, "../..");
const CODE_DIRS = ["src", "prisma", "scripts"];
const CODE_FILES = ["next.config.ts"];
/** Set by the platform or the test harness, never by the owner: not for the table. */
const PLATFORM_OR_TEST = [/^MOCK_/, /^NEXT_/, /^RAILWAY_/, /^SEED_FORCE$/, /^CI$/, /^PW_/, /^TEST_DATABASE_URL$/];
/** Read today, removed by security item 3 (the dev sign-in path): accepted either way until that lands, then delete this line. */
const RETIRING = [/^DEV_MODE$/, /^DEV_ADMIN_EMAIL$/];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

function namesReadByCode(): Set<string> {
  const files = [...CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d))), ...CODE_FILES.map((f) => path.join(ROOT, f))];
  const names = new Set<string>();
  for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1]);
  return names;
}

function namesInEnvExample(): Set<string> {
  return new Set([...readFileSync(path.join(ROOT, ".env.example"), "utf8").matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
}

function namesInReadmeTable(): Set<string> {
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  const section = readme.split("## Variables the code reads")[1]?.split("\n## ")[0] ?? "";
  expect(section, "README has the 'Variables the code reads' section").not.toBe("");
  const names = new Set<string>();
  for (const m of section.matchAll(/`([A-Z][A-Z0-9_]+)(\*?)`/g)) names.add(m[1] + m[2]);
  return names;
}

const isPlatformOrTest = (n: string) => [...PLATFORM_OR_TEST, ...RETIRING].some((re) => re.test(n));
/** A README entry may name a family with a trailing star: `GOOGLE_VERTEX_*` covers every GOOGLE_VERTEX_ name. */
const coveredByReadme = (n: string, table: Set<string>) => table.has(n) || [...table].some((t) => t.endsWith("*") && n.startsWith(t.slice(0, -1)));

describe("variables the code reads are documented by name (security item 12)", () => {
  const code = namesReadByCode();
  const example = namesInEnvExample();
  const table = namesInReadmeTable();

  it("reads at least the core set, so the scan itself works", () => {
    for (const n of ["DATABASE_URL", "SESSION_SECRET", "APP_URL", "ANTHROPIC_API_KEY"]) expect(code.has(n), n).toBe(true);
  });

  it("every variable the code reads is in .env.example, unless the platform or the tests set it", () => {
    const missing = [...code].filter((n) => !isPlatformOrTest(n) && !example.has(n)).sort();
    expect(missing).toEqual([]);
  });

  it("every variable the code reads is in the README table, by name or by family", () => {
    const missing = [...code].filter((n) => !isPlatformOrTest(n) && !coveredByReadme(n, table)).sort();
    expect(missing).toEqual([]);
  });

  it("nothing documented is dead: every name in .env.example is read somewhere", () => {
    const dead = [...example].filter((n) => !code.has(n) && !RETIRING.some((re) => re.test(n))).sort();
    expect(dead).toEqual([]);
  });
});

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Security item 2 (PF-09): the repository holds no real person's address. Only these domains may appear in tracked
 * text files. The check is a pattern, so this file itself names no real address.
 */
const ALLOWED_DOMAINS = [
  "example.test", // the synthetic household and other test fixtures
  "example.com", // documentation examples
  "resend.dev", // Resend's documented onboarding sender, the default EMAIL_FROM in src/lib/email.ts
  "group.calendar.google.com", // the shape of a Google Calendar id, not a person
];
const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|md|css|html|txt|yml|yaml|sql|prisma|toml|sh|example)$|(^|\/)\.env/i;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

function trackedTextFiles(): string[] {
  return execSync("git ls-files", { encoding: "utf8" }).split("\n").filter((f) => f && TEXT_FILE.test(f));
}

describe("no personal data in the tree", () => {
  it("every e-mail address in a tracked text file is on an allowed test or documentation domain", () => {
    const hits: string[] = [];
    for (const file of trackedTextFiles()) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(EMAIL)) {
        const domain = m[1].toLowerCase();
        if (!ALLOWED_DOMAINS.some((a) => domain === a || domain.endsWith(`.${a}`))) hits.push(`${file}: …@${domain}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the seed exports no people", () => {
    const seedData = readFileSync("prisma/seed-data.ts", "utf8");
    expect(seedData).not.toMatch(/export const PEOPLE\b/);
    expect(seedData).not.toMatch(/export const BODY_IMAGE_APPROVALS\b/);
  });
});

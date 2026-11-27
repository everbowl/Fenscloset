import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb, seed } from "../helpers";
import { FIXTURE_ADMIN_EMAIL } from "../fixtures/people-data";
import { login } from "@/lib/auth/login";
import { hashPassword } from "@/lib/auth/password";
import { setPassword, validateNewPassword } from "@/lib/auth/change-password";

const PASSWORD = "closet-rocks-2026";
const admin = () => db.person.findUniqueOrThrow({ where: { email: FIXTURE_ADMIN_EMAIL } });

describe("sign-in", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
    await setPassword((await admin()).id, PASSWORD);
  });

  it("one answer for every failure: unknown address, no password yet, wrong password; the right password signs in", async () => {
    expect(await login("nobody@example.com", "whatever-123")).toEqual({ ok: false });
    expect(await login(FIXTURE_ADMIN_EMAIL, "not-the-password-1")).toEqual({ ok: false });
    const casey = await db.person.findFirstOrThrow({ where: { name: "Casey" } });
    await db.person.update({ where: { id: casey.id }, data: { email: "casey@example.com" } }); // invited, no password yet
    expect(await login("casey@example.com", "anything-goes-1")).toEqual({ ok: false });
    const ok = await login(" Avery@Example.test ", PASSWORD);
    expect(ok.ok && ok.person.name === "Avery" && !ok.person.mustChangePassword).toBe(true);
  });

  it("no code path accepts a password shorter than 8 characters, and a 4-digit value never signs anyone in", async () => {
    for (const short of ["1234", "0000", "9876", "short"]) expect(validateNewPassword(short)).not.toBeNull();
    expect(validateNewPassword(PASSWORD)).toBeNull();
    for (const digits of ["1234", "0000", "9876"]) expect(await login(FIXTURE_ADMIN_EMAIL, digits)).toEqual({ ok: false });
  });

  it("a stored dev-flagged hash no longer signs in after the migration's data step", async () => {
    // A row the retired code could have left behind: the one-time flag on, and a 4-digit value as the hash.
    const a = await admin();
    await db.person.update({ where: { id: a.id }, data: { passwordHash: await hashPassword("4321"), devPasswordActive: true, mustChangePassword: true } });
    await db.session.create({ data: { personId: a.id, tokenHash: "dev-session", expiresAt: new Date(Date.now() + 60_000), usedDevPassword: true } });
    const sql = readFileSync("prisma/migrations/20261127093000_retire_dev_password/migration.sql", "utf8");
    for (const statement of sql.split("\n").filter((l) => l.trim() && !l.startsWith("--"))) await db.$executeRawUnsafe(statement);
    expect(await login(FIXTURE_ADMIN_EMAIL, "4321")).toEqual({ ok: false });
    const after = await admin();
    expect(after.passwordHash).toBeNull();
    expect(after.devPasswordActive).toBe(false);
    expect(after.mustChangePassword).toBe(true); // the way back in is a reset link
    expect(await db.session.count({ where: { personId: a.id } })).toBe(0);
  });

  it("a password set after a reset works, and the old one does not", async () => {
    const a = await admin();
    await setPassword(a.id, "a-brand-new-password-1");
    expect((await login(FIXTURE_ADMIN_EMAIL, "a-brand-new-password-1")).ok).toBe(true);
    expect(await login(FIXTURE_ADMIN_EMAIL, PASSWORD)).toEqual({ ok: false });
  });

  it("normal members sign in with their own password", async () => {
    const b = await db.person.findFirstOrThrow({ where: { name: "Blake" } });
    await db.person.update({ where: { id: b.id }, data: { email: "blake@example.com", passwordHash: await hashPassword("hello-world-1"), status: "active" } });
    const r = await login("blake@example.com", "hello-world-1");
    expect(r.ok && r.person.name === "Blake").toBe(true);
  });
});

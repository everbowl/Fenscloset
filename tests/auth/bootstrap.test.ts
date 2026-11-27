import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed as seedDefaults } from "../../prisma/seed";
import { seedPeople } from "../fixtures/people";
import { bootstrapAdmin } from "@/lib/auth/bootstrap";
import { consumeResetToken } from "@/lib/auth/reset";
import { setPassword } from "@/lib/auth/change-password";
import { login } from "@/lib/auth/login";

describe("first-admin bootstrap (security item 3)", () => {
  beforeEach(async () => { await resetDb(); await seedDefaults(); delete process.env.RESEND_API_KEY; });

  it("creates an invited admin with no password and exactly one reset token; the link signs in once and never twice", async () => {
    const r = await bootstrapAdmin(" First.Admin@Example.test ", { print: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const person = await db.person.findUniqueOrThrow({ where: { id: r.personId } });
    expect(person).toMatchObject({ email: "first.admin@example.test", role: "admin", status: "invited", passwordHash: null });
    expect(await db.person.count()).toBe(1);
    expect(await db.passwordResetToken.count()).toBe(1);
    expect(await db.closet.count({ where: { ownerId: person.id, kind: "personal" } })).toBe(1);
    const token = r.link!.split("/reset-password/")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(await consumeResetToken(token, "a-real-password-1")).toMatchObject({ ok: true });
    expect(await consumeResetToken(token, "another-password-2")).toEqual({ ok: false }); // single use
    expect((await login("first.admin@example.test", "a-real-password-1")).ok).toBe(true);
    expect(await login("first.admin@example.test", "another-password-2")).toEqual({ ok: false });
  });

  it("refuses while an admin with a password exists, and creates nothing", async () => {
    const ids = await seedPeople();
    await setPassword(ids.admin, "closet-rocks-2026");
    const before = await db.person.count();
    const r = await bootstrapAdmin("someone-else@example.test", { print: true });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/already exists/) });
    expect(await db.person.count()).toBe(before);
    expect(await db.passwordResetToken.count()).toBe(0);
  });

  it("without --print it never returns the link; with no mail set up it refuses and leaves no token", async () => {
    const r = await bootstrapAdmin("first.admin@example.test");
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/--print/) });
    expect("link" in r).toBe(false);
    expect(await db.passwordResetToken.count()).toBe(0);
  });

  it("refuses a value that is not an address", async () => {
    expect(await bootstrapAdmin("not-an-address", { print: true })).toMatchObject({ ok: false });
    expect(await db.person.count()).toBe(0);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { login } from "@/lib/auth/login";
import { hashPassword } from "@/lib/auth/password";
import { setPassword, validateNewPassword } from "@/lib/auth/change-password";

describe("login + DEV MODE 0535 rule", () => {
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true";
    await seed();
  });

  it("lets Jeff in once with 0535, then disables it", async () => {
    const first = await login("Jeff@Everbowl.com", "0535");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.usedDevPassword).toBe(true);
    expect(first.person.mustChangePassword).toBe(true);
    const jeff = await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } });
    expect(jeff.devPasswordActive).toBe(false);
    expect(jeff.devPasswordUsedAt).not.toBeNull();

    const second = await login("jeff@everbowl.com", "0535");
    expect(second).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses 0535 when DEV_MODE is off, even if the seed left it active", async () => {
    process.env.DEV_MODE = "false";
    expect(await login("jeff@everbowl.com", "0535")).toEqual({ ok: false, reason: "invalid" });
    const jeff = await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } });
    expect(jeff.devPasswordActive).toBe(true); // untouched: not consumed by a refused attempt
  });

  it("rejects wrong passwords and unknown emails", async () => {
    expect(await login("jeff@everbowl.com", "0536")).toEqual({ ok: false, reason: "invalid" });
    expect(await login("nobody@example.com", "0535")).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports no_password for invited people without a password", async () => {
    await db.person.update({ where: { name: "Olivia" } as never, data: { email: "olivia@example.com" } }).catch(async () => {
      const o = await db.person.findFirstOrThrow({ where: { name: "Olivia" } });
      await db.person.update({ where: { id: o.id }, data: { email: "olivia@example.com" } });
    });
    expect(await login("olivia@example.com", "anything")).toEqual({ ok: false, reason: "no_password" });
  });

  it("after a forced change, the new password works and 0535 does not", async () => {
    const first = await login("jeff@everbowl.com", "0535");
    expect(first.ok).toBe(true);
    const jeffId = (await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } })).id;
    expect(validateNewPassword("0535")).not.toBeNull();
    expect(validateNewPassword("short")).not.toBeNull();
    expect(validateNewPassword("closet-rocks-2026")).toBeNull();
    await setPassword(jeffId, "closet-rocks-2026");
    const again = await login("jeff@everbowl.com", "closet-rocks-2026");
    expect(again.ok && !again.usedDevPassword && !again.person.mustChangePassword).toBe(true);
    expect(await login("jeff@everbowl.com", "0535")).toEqual({ ok: false, reason: "invalid" });
  });

  it("normal members log in with their own password", async () => {
    const b = await db.person.findFirstOrThrow({ where: { name: "Brittney" } });
    await db.person.update({ where: { id: b.id }, data: { email: "brittney@example.com", passwordHash: await hashPassword("hello-world-1"), status: "active" } });
    const r = await login("brittney@example.com", "hello-world-1");
    expect(r.ok && r.person.name === "Brittney" && !r.usedDevPassword).toBe(true);
  });
});

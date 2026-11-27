import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { hasUsablePassword, login } from "@/lib/auth/login";
import { hashPassword } from "@/lib/auth/password";
import { setPassword, validateNewPassword } from "@/lib/auth/change-password";
import { checkRateLimit, MAX_TRIES, noteFailure, clearRateLimit, rateLimitKey, resetRateLimits } from "@/lib/auth/rate-limit";

describe("login + DEV MODE 0535 rule", () => {
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true";
    await seed();
  });

  it("lets Avery in once with 0535, then says it was used until a real password is saved", async () => {
    const first = await login("Avery@Example.test", "0535");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.usedDevPassword).toBe(true);
    expect(first.person.mustChangePassword).toBe(true);
    const avery = await db.person.findUniqueOrThrow({ where: { email: "avery@example.test" } });
    expect(avery.devPasswordActive).toBe(false);
    expect(avery.devPasswordUsedAt).not.toBeNull();
    // The consumed hash stays until the new password lands (review A A2), but it is not a password anyone can use.
    expect(avery.passwordHash).not.toBeNull();
    expect(hasUsablePassword(avery)).toBe(false);

    const second = await login("avery@example.test", "0535");
    expect(second).toEqual({ ok: false, reason: "dev_used" });
    expect(await login("avery@example.test", "anything-else")).toEqual({ ok: false, reason: "dev_used" });
  });

  it("two phones at once: only one consumes 0535", async () => {
    const [a, b] = await Promise.all([login("avery@example.test", "0535"), login("avery@example.test", "0535")]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser).toEqual({ ok: false, reason: "dev_used" });
  });

  it("rate limit: five tries, then a wait, then clear on success", () => {
    resetRateLimits();
    const key = rateLimitKey("1.2.3.4", "Avery@Example.test");
    expect(key).toBe("1.2.3.4|avery@example.test");
    for (let i = 0; i < MAX_TRIES; i++) { expect(checkRateLimit(key).ok).toBe(true); noteFailure(key); }
    const refused = checkRateLimit(key);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.minutesLeft).toBeGreaterThan(0);
    expect(checkRateLimit(rateLimitKey("5.6.7.8", "avery@example.test")).ok).toBe(true); // another network is its own count
    clearRateLimit(key);
    expect(checkRateLimit(key).ok).toBe(true);
  });

  it("refuses 0535 when DEV_MODE is off, even if the seed left it active", async () => {
    process.env.DEV_MODE = "false";
    expect(await login("avery@example.test", "0535")).toEqual({ ok: false, reason: "invalid" });
    const avery = await db.person.findUniqueOrThrow({ where: { email: "avery@example.test" } });
    expect(avery.devPasswordActive).toBe(true); // untouched: not consumed by a refused attempt
  });

  it("rejects wrong passwords and unknown emails", async () => {
    expect(await login("avery@example.test", "0536")).toEqual({ ok: false, reason: "invalid" });
    expect(await login("nobody@example.com", "0535")).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports no_password for invited people without a password", async () => {
    await db.person.update({ where: { name: "Casey" } as never, data: { email: "casey@example.com" } }).catch(async () => {
      const o = await db.person.findFirstOrThrow({ where: { name: "Casey" } });
      await db.person.update({ where: { id: o.id }, data: { email: "casey@example.com" } });
    });
    expect(await login("casey@example.com", "anything")).toEqual({ ok: false, reason: "no_password" });
  });

  it("after a forced change, the new password works and 0535 does not", async () => {
    const first = await login("avery@example.test", "0535");
    expect(first.ok).toBe(true);
    const averyId = (await db.person.findUniqueOrThrow({ where: { email: "avery@example.test" } })).id;
    expect(validateNewPassword("0535")).not.toBeNull();
    expect(validateNewPassword("short")).not.toBeNull();
    expect(validateNewPassword("closet-rocks-2026")).toBeNull();
    await setPassword(averyId, "closet-rocks-2026");
    const again = await login("avery@example.test", "closet-rocks-2026");
    expect(again.ok && !again.usedDevPassword && !again.person.mustChangePassword).toBe(true);
    expect(await login("avery@example.test", "0535")).toEqual({ ok: false, reason: "invalid" });
  });

  it("normal members log in with their own password", async () => {
    const b = await db.person.findFirstOrThrow({ where: { name: "Blake" } });
    await db.person.update({ where: { id: b.id }, data: { email: "blake@example.com", passwordHash: await hashPassword("hello-world-1"), status: "active" } });
    const r = await login("blake@example.com", "hello-world-1");
    expect(r.ok && r.person.name === "Blake" && !r.usedDevPassword).toBe(true);
  });
});

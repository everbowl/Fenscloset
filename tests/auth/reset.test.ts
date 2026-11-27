import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { consumeResetToken, createResetToken, peekResetToken, sendResetEmail } from "@/lib/auth/reset";
import { login } from "@/lib/auth/login";
import { createSession, validateSession } from "@/lib/auth/session";

async function casey() {
  return db.person.create({ data: { name: "Casey", email: "casey@example.com", role: "member", status: "active" } });
}

describe("password reset", () => {
  beforeEach(resetDb);

  it("returns null for unknown emails without throwing; sending says when the site cannot mail at all", async () => {
    expect(await createResetToken("nobody@example.com")).toBeNull();
    const key = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      // No mail service: the person is told, instead of "it's on its way" (review A A3).
      await expect(sendResetEmail("nobody@example.com")).resolves.toEqual({ sent: false, reason: "not_configured" });
      expect(await db.passwordResetToken.count()).toBe(0);
    } finally {
      if (key) process.env.RESEND_API_KEY = key;
    }
  });

  it("using a token retires the person's other open tokens", async () => {
    await casey();
    const a = await createResetToken("casey@example.com");
    const b = await createResetToken("casey@example.com");
    expect((await consumeResetToken(a!.token, "sunny-days-2026")).ok).toBe(true);
    expect((await peekResetToken(b!.token)).valid).toBe(false);
    expect((await consumeResetToken(b!.token, "another-pass-99")).ok).toBe(false);
  });

  it("works exactly once, sets the password, and signs out other sessions", async () => {
    const p = await casey();
    const other = await createSession(p.id);
    const created = await createResetToken("Casey@Example.com");
    expect(created?.personId).toBe(p.id);
    expect((await peekResetToken(created!.token)).valid).toBe(true);

    const first = await consumeResetToken(created!.token, "sunny-days-2026");
    expect(first.ok).toBe(true);
    expect((await login("casey@example.com", "sunny-days-2026")).ok).toBe(true);
    expect(await validateSession(other.token)).toBeNull();

    expect((await peekResetToken(created!.token)).valid).toBe(false);
    expect((await consumeResetToken(created!.token, "another-pass-99")).ok).toBe(false);
    expect((await login("casey@example.com", "another-pass-99")).ok).toBe(false);
  });

  it("rejects expired tokens", async () => {
    await casey();
    const created = await createResetToken("casey@example.com");
    await db.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await peekResetToken(created!.token)).valid).toBe(false);
    expect((await consumeResetToken(created!.token, "sunny-days-2026")).ok).toBe(false);
  });

  it("rejects garbage tokens", async () => {
    expect((await consumeResetToken("nope", "sunny-days-2026")).ok).toBe(false);
  });
});

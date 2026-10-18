import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { createSession, destroySession, destroyAllSessionsFor, validateSession, SESSION_TTL_MS } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";

async function makePerson(email = "jeff@everbowl.com") {
  return db.person.create({ data: { name: "Jeff", email, role: "admin", status: "active" } });
}

describe("sessions", () => {
  beforeEach(resetDb);

  it("creates a session whose raw token is never stored", async () => {
    const p = await makePerson();
    const { token, expiresAt } = await createSession(p.id, { userAgent: "iPhone" });
    const row = await db.session.findFirstOrThrow();
    expect(row.tokenHash).toEqual(hashToken(token));
    expect(row.tokenHash).not.toEqual(token);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(SESSION_TTL_MS - 5000);
    expect(row.userAgent).toBe("iPhone");
  });

  it("validates a live session and returns the person", async () => {
    const p = await makePerson();
    const { token } = await createSession(p.id);
    const s = await validateSession(token);
    expect(s?.person.email).toBe("jeff@everbowl.com");
    expect(await validateSession("nope")).toBeNull();
    expect(await validateSession("")).toBeNull();
  });

  it("rejects and deletes an expired session", async () => {
    const p = await makePerson();
    const { token } = await createSession(p.id);
    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSession(token)).toBeNull();
    expect(await db.session.count()).toBe(0);
  });

  it("slides the expiry when fewer than 15 days remain", async () => {
    const p = await makePerson();
    const { token } = await createSession(p.id);
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await db.session.updateMany({ data: { expiresAt: soon } });
    const s = await validateSession(token);
    expect(s!.expiresAt.getTime()).toBeGreaterThan(soon.getTime() + 20 * 24 * 60 * 60 * 1000);
  });

  it("rejects sessions of removed people", async () => {
    const p = await makePerson();
    const { token } = await createSession(p.id);
    await db.person.update({ where: { id: p.id }, data: { status: "removed" } });
    expect(await validateSession(token)).toBeNull();
  });

  it("destroys one or all sessions", async () => {
    const p = await makePerson();
    const a = await createSession(p.id);
    const b = await createSession(p.id);
    await destroySession(a.token);
    expect(await validateSession(a.token)).toBeNull();
    expect(await validateSession(b.token)).not.toBeNull();
    await destroyAllSessionsFor(p.id);
    expect(await db.session.count()).toBe(0);
  });
});

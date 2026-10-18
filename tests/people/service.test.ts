import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { acceptInvite, createInvite, peekInvite } from "@/lib/auth/invite";
import { listPeople, removePerson, setGuardians, setRole, updatePersonDetails } from "@/lib/people/service";
import { login } from "@/lib/auth/login";
import { createSession, validateSession } from "@/lib/auth/session";

async function jeff() { return db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } }); }
async function byName(name: string) { return db.person.findFirstOrThrow({ where: { name } }); }

describe("people, invites, roles, removal", () => {
  beforeEach(async () => { await resetDb(); process.env.DEV_MODE = "true"; await seed(); });

  it("invites a brand-new member who gets a login, a closet, and the right role", async () => {
    const j = await jeff();
    const inv = await createInvite({ name: "Grandma Sue", email: "Sue@Example.com", role: "member", createdById: j.id });
    expect(inv.url).toContain("/invite/");
    expect(await peekInvite(inv.token)).toMatchObject({ name: "Grandma Sue", email: "sue@example.com", role: "member" });

    const res = await acceptInvite(inv.token, { name: "Sue", password: "grandma-rules-1" });
    expect(res.ok).toBe(true);
    const sue = await db.person.findUniqueOrThrow({ where: { email: "sue@example.com" } });
    expect(sue.status).toBe("active");
    expect(await db.closet.count({ where: { ownerId: sue.id, kind: "personal" } })).toBe(1);
    expect((await login("sue@example.com", "grandma-rules-1")).ok).toBe(true);

    expect(await peekInvite(inv.token)).toBeNull();
    expect((await acceptInvite(inv.token, { name: "Again", password: "grandma-rules-2" })).ok).toBe(false);
  });

  it("invites a minor with guardians, and activates a seeded family member via invite", async () => {
    const j = await jeff();
    const b = await byName("Brittney");
    const minor = await createInvite({ name: "Cousin Max", email: "max@example.com", role: "minor", guardianIds: [j.id, b.id], createdById: j.id });
    const r = await acceptInvite(minor.token, { name: "Max", password: "max-is-cool-1" });
    expect(r.ok).toBe(true);
    const max = await db.person.findUniqueOrThrow({ where: { email: "max@example.com" }, include: { guardians: true } });
    expect(max.role).toBe("minor");
    expect(max.guardians.map((g) => g.parentId).sort()).toEqual([j.id, b.id].sort());

    await expect(createInvite({ name: "Orphan", email: "o@example.com", role: "minor", createdById: j.id })).rejects.toThrow(/parent admin/);

    const olivia = await byName("Olivia");
    const inv = await createInvite({ name: olivia.name, email: "olivia@example.com", role: "member", createdById: j.id, personId: olivia.id });
    expect((await listPeople()).find((p) => p.id === olivia.id)?.pendingInvite).toBe(true);
    const ok = await acceptInvite(inv.token, { name: "Olivia", password: "olivia-pass-1" });
    expect(ok.ok).toBe(true);
    expect(await db.person.count()).toBe(5); // 4 seeded + Max; Olivia was activated, not duplicated
    expect((await login("olivia@example.com", "olivia-pass-1")).ok).toBe(true);
  });

  it("rejects an invite whose email is already taken", async () => {
    const j = await jeff();
    const inv = await createInvite({ name: "Dup", email: "jeff@everbowl.com", role: "member", createdById: j.id });
    const r = await acceptInvite(inv.token, { name: "Dup", password: "duplicate-1x" });
    expect(r.ok).toBe(false);
    expect(await peekInvite(inv.token)).not.toBeNull(); // released for retry with a different email
  });

  it("changes roles but never demotes the last admin; guardians only for minors", async () => {
    const j = await jeff();
    const b = await byName("Brittney");
    await setRole(b.id, "member");
    await expect(setRole(j.id, "member")).rejects.toThrow(/at least one admin/);
    await setRole(b.id, "admin");
    const mya = await byName("Mya");
    await setGuardians(mya.id, [j.id]);
    expect((await listPeople()).find((p) => p.id === mya.id)?.guardianIds).toEqual([j.id]);
    await expect(setGuardians(b.id, [j.id])).rejects.toThrow(/Only minors/);
    await expect(updatePersonDetails(b.id, { email: "jeff@everbowl.com" })).rejects.toThrow(/already used/);
    await updatePersonDetails(b.id, { phone: "(555) 123-4567" });
    expect((await byName("Brittney")).phone).toBe("+15551234567");
  });

  it("removes a person: deletes or moves their items to Family, revokes sessions, keeps admins safe", async () => {
    const j = await jeff();
    const olivia = await byName("Olivia");
    const tops = await db.category.findFirstOrThrow({ where: { name: "Tops" } });
    const oc = await db.closet.findFirstOrThrow({ where: { ownerId: olivia.id } });
    for (let i = 0; i < 3; i++) {
      const it = await db.item.create({ data: { ownerId: olivia.id, categoryId: tops.id, name: `Top ${i}` } });
      await db.itemCloset.create({ data: { itemId: it.id, closetId: oc.id } });
    }
    const sess = await createSession(olivia.id);
    const result = await removePerson(olivia.id, { items: "moveToFamily", byAdminId: j.id });
    expect(result.movedItems).toBe(3);
    const family = await db.closet.findFirstOrThrow({ where: { kind: "family" } });
    expect(await db.itemCloset.count({ where: { closetId: family.id } })).toBe(3);
    expect(await db.item.count({ where: { ownerId: j.id } })).toBe(3);
    expect(await validateSession(sess.token)).toBeNull();
    expect((await listPeople()).some((p) => p.id === olivia.id)).toBe(false);

    const mya = await byName("Mya");
    await db.item.create({ data: { ownerId: mya.id, categoryId: tops.id, name: "Hoodie" } });
    const r2 = await removePerson(mya.id, { items: "delete", byAdminId: j.id });
    expect(r2.deletedItems).toBe(1);

    await expect(removePerson(j.id, { items: "delete", byAdminId: j.id })).rejects.toThrow(/yourself/);
    const b = await byName("Brittney");
    await removePerson(b.id, { items: "delete", byAdminId: j.id });
    await expect(setRole(j.id, "member")).rejects.toThrow(/at least one admin/);
  });
});

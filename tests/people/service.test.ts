import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setPassword } from "@/lib/auth/change-password";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { acceptInvite, cancelInvite, createInvite, listOpenInvites, peekInvite, renewInvite } from "@/lib/auth/invite";
import { listPeople, removePerson, setGuardians, setRole, updatePersonDetails } from "@/lib/people/service";
import { login } from "@/lib/auth/login";
import { createSession, validateSession } from "@/lib/auth/session";
import { canViewKey } from "@/lib/photos/visibility";

async function avery() { return db.person.findUniqueOrThrow({ where: { email: "avery@example.test" } }); }
async function byName(name: string) { return db.person.findFirstOrThrow({ where: { name } }); }

describe("people, invites, roles, removal", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("invites a brand-new member who gets a login, a closet, and the right role", async () => {
    const j = await avery();
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
    const j = await avery();
    const b = await byName("Blake");
    const minor = await createInvite({ name: "Cousin Max", email: "max@example.com", role: "minor", guardianIds: [j.id, b.id], createdById: j.id });
    const r = await acceptInvite(minor.token, { name: "Max", password: "max-is-cool-1" });
    expect(r.ok).toBe(true);
    const max = await db.person.findUniqueOrThrow({ where: { email: "max@example.com" }, include: { guardians: true } });
    expect(max.role).toBe("minor");
    expect(max.guardians.map((g) => g.parentId).sort()).toEqual([j.id, b.id].sort());

    await expect(createInvite({ name: "Orphan", email: "o@example.com", role: "minor", createdById: j.id })).rejects.toThrow(/parent admin/);
    // Parents named on an invite have to be real, active admins (review A S7): Casey is a member, so she does not count.
    const casey = await byName("Casey");
    await expect(createInvite({ name: "Orphan", email: "o@example.com", role: "minor", guardianIds: [casey.id, "nope"], createdById: j.id })).rejects.toThrow(/parent admin/);

    const inv = await createInvite({ name: casey.name, email: "casey@example.com", role: "member", createdById: j.id, personId: casey.id });
    expect((await listPeople()).find((p) => p.id === casey.id)?.pendingInvite).toBe(true);
    expect((await byName("Casey")).email).toBeNull(); // the address lands when she accepts, not before (review A S7)
    const ok = await acceptInvite(inv.token, { name: "Casey", password: "casey-pass-1" });
    expect(ok.ok).toBe(true);
    expect((await byName("Casey")).email).toBe("casey@example.com");
    expect(await db.person.count()).toBe(5); // 4 seeded + Max; Casey was activated, not duplicated
    expect((await login("casey@example.com", "casey-pass-1")).ok).toBe(true);
  });

  it("refuses an invite whose email is already taken, before any token exists", async () => {
    const j = await avery();
    await expect(createInvite({ name: "Dup", email: "avery@example.test", role: "member", createdById: j.id })).rejects.toThrow(/already belongs/);
    expect(await db.inviteToken.count()).toBe(0);
    // Re-inviting the person who owns the address is fine.
    await expect(createInvite({ name: "Avery", email: "avery@example.test", role: "admin", createdById: j.id, personId: j.id })).resolves.toBeTruthy();
    // A race that slips past the check still comes back with words and a reusable invite.
    const inv = await createInvite({ name: "Dup", email: "dup@example.com", role: "member", createdById: j.id });
    await db.person.create({ data: { name: "Taken", email: "dup@example.com", role: "member", status: "active" } });
    const r = await acceptInvite(inv.token, { name: "Dup", password: "duplicate-1x" });
    expect(r.ok).toBe(false);
    expect(await peekInvite(inv.token)).not.toBeNull(); // released for retry with a different email
  });

  it("open invites can be listed, renewed (old link dies) and cancelled", async () => {
    const j = await avery();
    const inv = await createInvite({ name: "Grandma Sue", email: "sue@example.com", role: "member", createdById: j.id });
    expect((await listOpenInvites()).map((i) => i.name)).toEqual(["Grandma Sue"]);
    const fresh = await renewInvite(inv.inviteId, j.id);
    expect(fresh.url).toContain("/invite/");
    expect(await peekInvite(inv.token)).toBeNull();
    expect(await peekInvite(fresh.token)).toMatchObject({ name: "Grandma Sue", email: "sue@example.com" });
    expect((await listOpenInvites()).map((i) => i.id)).toEqual([fresh.invite.id]);
    await cancelInvite(fresh.invite.id);
    expect(await peekInvite(fresh.token)).toBeNull();
    expect(await listOpenInvites()).toEqual([]);
  });

  it("changes roles but never demotes the last admin; guardians only for minors", async () => {
    const j = await avery();
    const b = await byName("Blake");
    await setRole(b.id, "member");
    await expect(setRole(j.id, "member")).rejects.toThrow(/at least one admin/);
    await setRole(b.id, "admin");
    const devon = await byName("Devon");
    await setGuardians(devon.id, [j.id]);
    expect((await listPeople()).find((p) => p.id === devon.id)?.guardianIds).toEqual([j.id]);
    await expect(setGuardians(b.id, [j.id])).rejects.toThrow(/Only minors/);
    await expect(updatePersonDetails(b.id, { email: "avery@example.test" })).rejects.toThrow(/already used/);
    await updatePersonDetails(b.id, { phone: "(555) 123-4567" });
    expect((await byName("Blake")).phone).toBe("+15551234567");
  });

  it("an adult who becomes a minor needs a parent and loses the grants they handed out", async () => {
    const j = await avery();
    const b = await byName("Blake");
    const casey = await byName("Casey");
    const devon = await byName("Devon");
    await db.bodyDataGrant.create({ data: { ownerId: casey.id, viewerId: devon.id } });
    await db.shopForGrant.create({ data: { ownerId: casey.id, shopperId: devon.id } });
    await expect(setRole(casey.id, "minor")).rejects.toThrow(/parent admin/);
    await expect(setRole(casey.id, "minor", { guardianIds: [devon.id] })).rejects.toThrow(/parent admin/); // Devon is a minor, not an admin
    expect(await db.bodyDataGrant.count({ where: { ownerId: casey.id } })).toBe(1); // nothing changed on a refused change
    await setRole(casey.id, "minor", { guardianIds: [j.id, b.id, "nope"] });
    const after = await db.person.findUniqueOrThrow({ where: { id: casey.id }, include: { guardians: true } });
    expect(after.role).toBe("minor");
    expect(after.guardians.map((g) => g.parentId).sort()).toEqual([j.id, b.id].sort());
    expect(await db.bodyDataGrant.count({ where: { ownerId: casey.id } })).toBe(0);
    expect(await db.shopForGrant.count({ where: { ownerId: casey.id } })).toBe(0);
    // Back to adult: the parent links go.
    await setRole(casey.id, "member");
    expect(await db.guardianLink.count({ where: { minorId: casey.id } })).toBe(0);
  });

  it("an email that someone signs in with can change but not vanish", async () => {
    const j = await avery();
    await setPassword(j.id, "closet-rocks-2026"); // the fixture admin has no password until a test gives one
    await expect(updatePersonDetails(j.id, { email: null })).rejects.toThrow(/can't be cleared/);
    const casey = await byName("Casey");
    await updatePersonDetails(casey.id, { email: "casey@example.com" });
    await updatePersonDetails(casey.id, { email: null }); // no password yet: clearing is fine
    expect((await byName("Casey")).email).toBeNull();
  });

  it("removes a person: deletes or moves their items to Family, revokes sessions, keeps admins safe", async () => {
    const j = await avery();
    const casey = await byName("Casey");
    const tops = await db.category.findFirstOrThrow({ where: { name: "Tops" } });
    const oc = await db.closet.findFirstOrThrow({ where: { ownerId: casey.id } });
    for (let i = 0; i < 3; i++) {
      const it = await db.item.create({ data: { ownerId: casey.id, categoryId: tops.id, name: `Top ${i}` } });
      await db.itemCloset.create({ data: { itemId: it.id, closetId: oc.id } });
    }
    const sess = await createSession(casey.id);
    // A photo on one of her pieces: moved pieces keep their pictures (review A W2).
    const movedItem = await db.item.findFirstOrThrow({ where: { ownerId: casey.id } });
    const photoKey = `cutouts/${casey.id}/abcdef0123456789abcdef01.webp`;
    await db.itemPhoto.create({ data: { itemId: movedItem.id, kind: "cutout", bucketKey: photoKey, isPrimary: true } });
    const blake = await byName("Blake");
    expect(await canViewKey(blake, photoKey)).toBe(true);
    const result = await removePerson(casey.id, { items: "moveToFamily", byAdminId: j.id });
    expect(result.movedItems).toBe(3);
    const family = await db.closet.findFirstOrThrow({ where: { kind: "family" } });
    expect(await db.itemCloset.count({ where: { closetId: family.id } })).toBe(3);
    expect(await db.item.count({ where: { ownerId: j.id } })).toBe(3);
    expect(await validateSession(sess.token)).toBeNull();
    expect((await listPeople()).some((p) => p.id === casey.id)).toBe(false);
    expect(await canViewKey(blake, photoKey)).toBe(true); // the piece is Avery's now; the family still sees it
    expect(await canViewKey(blake, `avatars/${casey.id}/abcdef0123456789abcdef02.webp`)).toBe(false); // but not her avatar

    const devon = await byName("Devon");
    await db.item.create({ data: { ownerId: devon.id, categoryId: tops.id, name: "Hoodie" } });
    // Her body goes with her (review A S6): measurements, body photos, selfies, and the grants either way.
    const kind = await db.measurementKind.findFirstOrThrow();
    await db.bodyMeasurement.create({ data: { personId: devon.id, kindId: kind.id, value: "60" } });
    await db.bodyProfile.create({ data: { personId: devon.id, fitNotes: "runs small" } });
    await db.bodyPhoto.create({ data: { personId: devon.id, bucketKey: `bodies/${devon.id}/abcdef0123456789abcdef03.webp` } });
    await db.checkIn.create({ data: { personId: devon.id, date: "2026-11-23", source: "selfie", selfieKey: `checkins/${devon.id}/abcdef0123456789abcdef04.webp` } });
    await db.bodyDataGrant.create({ data: { ownerId: j.id, viewerId: devon.id } });
    const r2 = await removePerson(devon.id, { items: "delete", byAdminId: j.id });
    expect(r2.deletedItems).toBe(1);
    expect(await db.bodyMeasurement.count({ where: { personId: devon.id } })).toBe(0);
    expect(await db.bodyProfile.count({ where: { personId: devon.id } })).toBe(0);
    expect(await db.bodyPhoto.count({ where: { personId: devon.id } })).toBe(0);
    expect(await db.checkIn.count({ where: { personId: devon.id } })).toBe(0);
    expect(await db.bodyDataGrant.count({ where: { viewerId: devon.id } })).toBe(0);

    await expect(removePerson(j.id, { items: "delete", byAdminId: j.id })).rejects.toThrow(/yourself/);
    const b = await byName("Blake");
    await removePerson(b.id, { items: "delete", byAdminId: j.id });
    await expect(setRole(j.id, "member")).rejects.toThrow(/at least one admin/);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { listOpenRequests, requestListEntry, resolveRequest } from "@/lib/lists/requests";

describe("list requests (J1: Ask Jeff to add it)", () => {
  beforeEach(async () => { await resetDb(); await seed(); });
  it("records an ask once, names the admins, and an admin resolves it", async () => {
    const jeff = await db.person.findFirstOrThrow({ where: { role: "admin" } });
    const asker = (await db.person.findFirst({ where: { role: { not: "admin" }, status: { not: "removed" } } })) ?? jeff;
    const name = `Teal ${Date.now()}`;
    const first = await requestListEntry(asker.id, "color", name);
    expect(first.already).toBe(false);
    expect(first.admins).toContain(jeff.name.split(" ")[0]);
    const again = await requestListEntry(asker.id, "color", name.toLowerCase());
    expect(again.already).toBe(true);
    const open = await listOpenRequests();
    const mine = open.filter((r) => r.name === name);
    expect(mine).toHaveLength(1);
    expect(mine[0].kindLabel).toBe("Colors");
    await resolveRequest(mine[0].id, "added");
    expect((await listOpenRequests()).some((r) => r.name === name)).toBe(false);
    await expect(requestListEntry(asker.id, "color", "   ")).rejects.toThrow("Type the word first.");
  });
});

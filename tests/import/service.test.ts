import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { newKey, putObject } from "@/lib/storage";
import { abandonBatch, finishBatchIfDone, getOrCreateOpenBatch, openBatch, registerEntry, requeueUnfinished } from "@/lib/import/service";
import { drainQueue } from "@/lib/import/queue";
import { objectExists } from "@/lib/storage";

describe("import batches", () => {
  let jeffId: string; let oliviaId: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true";
    delete process.env.MOCK_REMOVE_BG_FAIL;
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-batch-"));
    await seed();
    jeffId = (await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } })).id;
    oliviaId = (await db.person.findFirstOrThrow({ where: { name: "Olivia" } })).id;
  });

  async function uploaded(ownerId: string) {
    const key = newKey("originals", ownerId, "image/jpeg");
    await putObject(key, await sharp({ create: { width: 400, height: 600, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer(), "image/jpeg");
    return key;
  }

  it("keeps one open batch per person and appends to it; counts, position and next-to-confirm follow pick order", async () => {
    const a = await getOrCreateOpenBatch(jeffId, 2);
    const b = await getOrCreateOpenBatch(jeffId, 3);
    expect(b.id).toBe(a.id);
    expect(b.total).toBe(5);
    expect(b.startOrder).toBe(0);
    const k1 = await uploaded(jeffId); const k2 = await uploaded(jeffId);
    const e1 = await registerEntry(jeffId, a.id, k1, 0);
    const e2 = await registerEntry(jeffId, a.id, k2, 1);
    expect((await registerEntry(jeffId, a.id, k1, 0)).id).toBe(e1.id); // idempotent on the same key
    await drainQueue();
    const s = (await openBatch(jeffId))!;
    expect(s.counts.needs_confirm).toBe(2);
    expect(s.nextConfirmId).toBe(e1.id);
    expect(s.position).toBe(1);
    expect(s.total).toBe(5);
    await db.importEntry.update({ where: { id: e1.id }, data: { status: "done" } });
    const s2 = (await openBatch(jeffId))!;
    expect(s2.nextConfirmId).toBe(e2.id);
    expect(s2.position).toBe(2);
    expect(await finishBatchIfDone(a.id)).toBe(false);
    await db.importEntry.update({ where: { id: e2.id }, data: { status: "skipped" } });
    expect(await finishBatchIfDone(a.id)).toBe(true);
    expect(await openBatch(jeffId)).toBeNull();
  });

  it("refuses photos and batches that are not yours", async () => {
    const mine = await getOrCreateOpenBatch(jeffId, 1);
    const hers = await uploaded(oliviaId);
    await expect(registerEntry(jeffId, mine.id, hers, 0)).rejects.toMatchObject({ status: 403 });
    const k = await uploaded(jeffId);
    await expect(registerEntry(oliviaId, mine.id, k, 0)).rejects.toMatchObject({ status: 403 });
    await expect(abandonBatch(oliviaId, mine.id)).rejects.toMatchObject({ status: 403 });
    await abandonBatch(jeffId, mine.id);
    expect(await openBatch(jeffId)).toBeNull();
  });

  it("re-queues work a restart left behind", async () => {
    const b = await getOrCreateOpenBatch(jeffId, 1);
    const k = await uploaded(jeffId);
    const e = await db.importEntry.create({ data: { batchId: b.id, order: 0, originalKey: k, status: "uploaded" } });
    await openBatch(jeffId); // sees an uploaded entry nobody is working on
    await drainQueue();
    expect((await db.importEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("needs_confirm");
  });

  it("a registered photo gets a small picture right away; the summary carries rows and the working list (review B B13, Add flow v2)", async () => {
    const b = await getOrCreateOpenBatch(jeffId, 1);
    const k = await uploaded(jeffId);
    const e = await registerEntry(jeffId, b.id, k, 0);
    const fresh = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(fresh.thumbKey).toMatch(/^thumbs\//);
    expect(await objectExists(fresh.thumbKey!)).toBe(true);
    await drainQueue();
    const s = (await openBatch(jeffId))!;
    expect(s.rows.map((r) => [r.id, r.status])).toEqual([[e.id, "needs_confirm"]]);
    expect(s.rows[0].photoKey).toMatch(/^thumbs\//); // the tagging run's thumb replaced the early one
    expect(await objectExists(fresh.thumbKey!)).toBe(false);
    expect(s.working).toEqual([]);
  });

  it("a batch nothing ever landed in closes once it has sat empty a while; picks taken back never drop the count under what arrived (review B B9)", async () => {
    const b = await getOrCreateOpenBatch(jeffId, 20);
    expect((await openBatch(jeffId))!.total).toBe(20); // fresh: still waiting for its uploads
    await db.importBatch.update({ where: { id: b.id }, data: { updatedAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await openBatch(jeffId)).toBeNull();
    expect((await db.importBatch.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("done");
    // taking failed picks back
    const c = await getOrCreateOpenBatch(jeffId, 5);
    const k = await uploaded(jeffId);
    await registerEntry(jeffId, c.id, k, 0);
    expect((await getOrCreateOpenBatch(jeffId, -4)).total).toBe(1);
    expect((await getOrCreateOpenBatch(jeffId, -4)).total).toBe(1); // never under the one that arrived
  });

  it("openBatch answers for the batch asked for, not whichever open batch is newest (review B B10)", async () => {
    const older = await db.importBatch.create({ data: { personId: jeffId, total: 1 } });
    const k = await uploaded(jeffId);
    const e = await db.importEntry.create({ data: { batchId: older.id, order: 0, originalKey: k, status: "needs_confirm" } });
    const newer = await db.importBatch.create({ data: { personId: jeffId, total: 0 } });
    expect((await openBatch(jeffId, older.id))!.nextConfirmId).toBe(e.id);
    expect((await openBatch(jeffId, newer.id))!.id).toBe(newer.id);
    expect((await openBatch(jeffId))!.id).toBe(older.id); // with no batch named, the one with work in it
    expect(await openBatch(oliviaId, older.id)).toBeNull(); // not hers
  });

  it("on server start every photo left mid-way goes back on the queue at once (review B A2.5)", async () => {
    const b = await getOrCreateOpenBatch(jeffId, 2);
    const k1 = await uploaded(jeffId); const k2 = await uploaded(jeffId);
    const a = await db.importEntry.create({ data: { batchId: b.id, order: 0, originalKey: k1, status: "processing" } });
    const c = await db.importEntry.create({ data: { batchId: b.id, order: 1, originalKey: k2, status: "uploaded" } });
    expect(await requeueUnfinished()).toBe(2);
    await drainQueue();
    expect((await db.importEntry.findMany({ where: { id: { in: [a.id, c.id] } } })).map((e) => e.status)).toEqual(["needs_confirm", "needs_confirm"]);
  });
});

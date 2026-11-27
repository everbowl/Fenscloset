import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { newKey, putObject } from "@/lib/storage";
import { abandonBatch, finishBatchIfDone, getOrCreateOpenBatch, openBatch, registerEntry, requeueUnfinished } from "@/lib/import/service";
import { drainQueue } from "@/lib/import/queue";
import { objectExists } from "@/lib/storage";

describe("import batches", () => {
  let averyId: string; let caseyId: string;
  beforeEach(async () => {
    await resetDb();
    process.env.DEV_MODE = "true"; process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true";
    delete process.env.MOCK_REMOVE_BG_FAIL;
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-batch-"));
    await seed();
    averyId = (await db.person.findUniqueOrThrow({ where: { email: "avery@example.test" } })).id;
    caseyId = (await db.person.findFirstOrThrow({ where: { name: "Casey" } })).id;
  });

  async function uploaded(ownerId: string) {
    const key = newKey("originals", ownerId, "image/jpeg");
    await putObject(key, await sharp({ create: { width: 400, height: 600, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer(), "image/jpeg");
    return key;
  }

  it("keeps one open batch per person and appends to it; counts, position and next-to-confirm follow pick order", async () => {
    const a = await getOrCreateOpenBatch(averyId, 2);
    const b = await getOrCreateOpenBatch(averyId, 3);
    expect(b.id).toBe(a.id);
    expect(b.total).toBe(5);
    expect(b.startOrder).toBe(0);
    const k1 = await uploaded(averyId); const k2 = await uploaded(averyId);
    const e1 = await registerEntry(averyId, a.id, k1, 0);
    const e2 = await registerEntry(averyId, a.id, k2, 1);
    expect((await registerEntry(averyId, a.id, k1, 0)).id).toBe(e1.id); // idempotent on the same key
    await drainQueue();
    const s = (await openBatch(averyId))!;
    expect(s.counts.needs_confirm).toBe(2);
    expect(s.nextConfirmId).toBe(e1.id);
    expect(s.position).toBe(1);
    expect(s.total).toBe(5);
    await db.importEntry.update({ where: { id: e1.id }, data: { status: "done" } });
    const s2 = (await openBatch(averyId))!;
    expect(s2.nextConfirmId).toBe(e2.id);
    expect(s2.position).toBe(2);
    expect(await finishBatchIfDone(a.id)).toBe(false);
    await db.importEntry.update({ where: { id: e2.id }, data: { status: "skipped" } });
    expect(await finishBatchIfDone(a.id)).toBe(true);
    expect(await openBatch(averyId)).toBeNull();
  });

  it("refuses photos and batches that are not yours", async () => {
    const mine = await getOrCreateOpenBatch(averyId, 1);
    const hers = await uploaded(caseyId);
    await expect(registerEntry(averyId, mine.id, hers, 0)).rejects.toMatchObject({ status: 403 });
    const k = await uploaded(averyId);
    await expect(registerEntry(caseyId, mine.id, k, 0)).rejects.toMatchObject({ status: 403 });
    await expect(abandonBatch(caseyId, mine.id)).rejects.toMatchObject({ status: 403 });
    await abandonBatch(averyId, mine.id);
    expect(await openBatch(averyId)).toBeNull();
  });

  it("re-queues work a restart left behind", async () => {
    const b = await getOrCreateOpenBatch(averyId, 1);
    const k = await uploaded(averyId);
    const e = await db.importEntry.create({ data: { batchId: b.id, order: 0, originalKey: k, status: "uploaded" } });
    await openBatch(averyId); // sees an uploaded entry nobody is working on
    await drainQueue();
    expect((await db.importEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("needs_confirm");
  });

  it("a registered photo gets a small picture right away; the summary carries rows and the working list (review B B13, Add flow v2)", async () => {
    const b = await getOrCreateOpenBatch(averyId, 1);
    const k = await uploaded(averyId);
    const e = await registerEntry(averyId, b.id, k, 0);
    const fresh = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(fresh.thumbKey).toMatch(/^thumbs\//);
    expect(await objectExists(fresh.thumbKey!)).toBe(true);
    await drainQueue();
    const s = (await openBatch(averyId))!;
    expect(s.rows.map((r) => [r.id, r.status])).toEqual([[e.id, "needs_confirm"]]);
    expect(s.rows[0].photoKey).toMatch(/^thumbs\//); // the tagging run's thumb replaced the early one
    expect(await objectExists(fresh.thumbKey!)).toBe(false);
    expect(s.working).toEqual([]);
  });

  it("a batch nothing ever landed in closes once it has sat empty a while; picks taken back never drop the count under what arrived (review B B9)", async () => {
    const b = await getOrCreateOpenBatch(averyId, 20);
    expect((await openBatch(averyId))!.total).toBe(20); // fresh: still waiting for its uploads
    await db.importBatch.update({ where: { id: b.id }, data: { updatedAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await openBatch(averyId)).toBeNull();
    expect((await db.importBatch.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("done");
    // taking failed picks back
    const c = await getOrCreateOpenBatch(averyId, 5);
    const k = await uploaded(averyId);
    await registerEntry(averyId, c.id, k, 0);
    expect((await getOrCreateOpenBatch(averyId, -4)).total).toBe(1);
    expect((await getOrCreateOpenBatch(averyId, -4)).total).toBe(1); // never under the one that arrived
  });

  it("openBatch answers for the batch asked for, not whichever open batch is newest (review B B10)", async () => {
    const older = await db.importBatch.create({ data: { personId: averyId, total: 1 } });
    const k = await uploaded(averyId);
    const e = await db.importEntry.create({ data: { batchId: older.id, order: 0, originalKey: k, status: "needs_confirm" } });
    const newer = await db.importBatch.create({ data: { personId: averyId, total: 0 } });
    expect((await openBatch(averyId, older.id))!.nextConfirmId).toBe(e.id);
    expect((await openBatch(averyId, newer.id))!.id).toBe(newer.id);
    expect((await openBatch(averyId))!.id).toBe(older.id); // with no batch named, the one with work in it
    expect(await openBatch(caseyId, older.id)).toBeNull(); // not hers
  });

  it("on server start every photo left mid-way goes back on the queue at once (review B A2.5)", async () => {
    const b = await getOrCreateOpenBatch(averyId, 2);
    const k1 = await uploaded(averyId); const k2 = await uploaded(averyId);
    const a = await db.importEntry.create({ data: { batchId: b.id, order: 0, originalKey: k1, status: "processing" } });
    const c = await db.importEntry.create({ data: { batchId: b.id, order: 1, originalKey: k2, status: "uploaded" } });
    expect(await requeueUnfinished()).toBe(2);
    await drainQueue();
    expect((await db.importEntry.findMany({ where: { id: { in: [a.id, c.id] } } })).map((e) => e.status)).toEqual(["needs_confirm", "needs_confirm"]);
  });
});

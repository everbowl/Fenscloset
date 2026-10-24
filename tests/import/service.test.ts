import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { newKey, putObject } from "@/lib/storage";
import { abandonBatch, finishBatchIfDone, getOrCreateOpenBatch, openBatch, registerEntry } from "@/lib/import/service";
import { drainQueue } from "@/lib/import/queue";

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
});

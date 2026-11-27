import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../helpers";
import { newKey, putObject } from "@/lib/storage";
import { pendingAdds } from "@/lib/import/pending";
import { processEntry } from "@/lib/import/process";
import { loadTagLists } from "@/lib/ai/tag-item";

/**
 * The closet's Tagging cards (review B A2.3, B6, A2.2): what the owner just added and where it stands, in every view of
 * their own closet, narrowed by category only where the category is known.
 */
describe("pending adds on the closet", () => {
  let averyId: string;
  beforeEach(async () => {
    await resetDb(); process.env.MOCK_AI = "true"; process.env.MOCK_S3 = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-pending-"));
    await seed();
    averyId = (await db.person.findUniqueOrThrow({ where: { email: "avery@example.test" } })).id;
  });

  async function entry(data: { status: "uploaded" | "processing" | "failed" | "needs_confirm"; storeMeta?: object; error?: string; aiResult?: object; thumb?: boolean }) {
    const batch = (await db.importBatch.findFirst({ where: { personId: averyId, status: "open" } })) ?? (await db.importBatch.create({ data: { personId: averyId } }));
    const originalKey = newKey("originals", averyId, "image/jpeg");
    await putObject(originalKey, await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 20, g: 20, b: 20 } } }).jpeg().toBuffer(), "image/jpeg");
    const thumbKey = data.thumb ? newKey("thumbs", averyId, "image/jpeg") : null;
    return db.importEntry.create({ data: { batchId: batch.id, order: 0, originalKey, thumbKey, status: data.status, storeMeta: data.storeMeta, error: data.error, aiResult: data.aiResult } });
  }

  it("shows tagging, failed and waiting pieces, with the small picture when there is one and when the entry last moved", async () => {
    const tagging = await entry({ status: "processing", thumb: true });
    const failed = await entry({ status: "failed", error: "Tagging failed: boom" });
    await entry({ status: "needs_confirm" });
    const p = await pendingAdds(averyId);
    expect(p.toConfirm?.count).toBe(1);
    expect(p.cards.map((c) => [c.id, c.status])).toEqual(expect.arrayContaining([[tagging.id, "tagging"], [failed.id, "failed"]]));
    expect(p.cards.find((c) => c.id === tagging.id)!.photoKey).toMatch(/^thumbs\//);
    expect(p.cards.find((c) => c.id === failed.id)!.photoKey).toMatch(/^originals\//);
    expect(p.cards.find((c) => c.id === failed.id)!.error).toBe("Tagging failed: boom");
    expect(new Date(p.cards[0].since!).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await pendingAdds((await db.person.findFirstOrThrow({ where: { name: "Casey" } })).id)).toEqual({ cards: [], toConfirm: null });
  });

  it("on a category tab a piece known to belong elsewhere is left out; an unknown one shows everywhere (review B A2.3)", async () => {
    const lists = await loadTagLists();
    const tops = lists.categories.find((c) => c.name === "Tops")!;
    const bottoms = lists.categories.find((c) => c.name === "Bottoms")!;
    const unknown = await entry({ status: "processing" });
    const knownTop = await entry({ status: "failed", error: "x", aiResult: { tags: { categoryId: tops.id }, warnings: [] } });
    expect((await pendingAdds(averyId)).cards.map((c) => c.id).sort()).toEqual([knownTop.id, unknown.id].sort());
    expect((await pendingAdds(averyId, { categoryId: tops.id })).cards.map((c) => c.id).sort()).toEqual([knownTop.id, unknown.id].sort());
    expect((await pendingAdds(averyId, { categoryId: bottoms.id })).cards.map((c) => c.id)).toEqual([unknown.id]);
  });

  it("a store piece that could not land on its own is a card of its own, with the reason and a way to its review card (review B B6)", async () => {
    const meta = { name: "Linen Blazer", brandText: null, storeName: "Mock Store", priceText: null, url: null, imageUrl: null, color: null, size: null, purchaseDate: null };
    const review = await entry({ status: "needs_confirm", storeMeta: meta, error: "Could not add it on its own: Pick a category first." });
    const plain = await entry({ status: "needs_confirm" });
    const p = await pendingAdds(averyId);
    expect(p.toConfirm).toEqual({ count: 1, batchId: plain.batchId });
    expect(p.cards.map((c) => [c.id, c.status, c.name, c.error])).toEqual([[review.id, "review", "Linen Blazer", "Could not add it on its own: Pick a category first."]]);
  });

  it("a store piece that landed with no category is a card that opens the piece (review B A2.2), and the whole chain holds together", async () => {
    await db.category.updateMany({ data: { isArchived: true } }); // the tagger has nothing to pick from
    const meta = { name: "Woven belt", brandText: null, storeName: "Mock Store", priceText: null, url: null, imageUrl: null, color: null, size: null, purchaseDate: null };
    const e = await entry({ status: "uploaded", storeMeta: meta });
    expect((await pendingAdds(averyId)).cards.map((c) => c.status)).toEqual(["tagging"]);
    expect(await processEntry(e.id)).toEqual({ status: "done" });
    const p = await pendingAdds(averyId);
    const done = await db.importEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(p.cards.map((c) => [c.status, c.itemId, c.name])).toEqual([["needs_category", done.itemId, "Woven belt"]]);
    expect(p.cards[0].photoKey).toMatch(/^thumbs\//);
    // once a category is picked on the piece, the card is gone
    await db.category.updateMany({ data: { isArchived: false } });
    const tops = await db.category.findFirstOrThrow({ where: { name: "Tops" } });
    await db.item.update({ where: { id: done.itemId! }, data: { categoryId: tops.id } });
    expect((await pendingAdds(averyId)).cards).toEqual([]);
  });
});

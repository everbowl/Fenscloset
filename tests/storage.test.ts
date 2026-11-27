import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { resetDb } from "./helpers";
import { seed } from "./helpers";
import { deleteObject, getObject, newKey, objectExists, parseKey, putObject, signUpload, storageMode, verifyUploadToken } from "@/lib/storage";
import { canViewKey } from "@/lib/photos/visibility";

describe("storage (mock bucket)", () => {
  beforeEach(async () => {
    process.env.MOCK_S3 = "true";
    process.env.MOCK_S3_DIR = await mkdtemp(path.join(os.tmpdir(), "fc-s3-"));
  });

  it("uses the mock store when MOCK_S3 is set", () => {
    expect(storageMode()).toBe("mock");
  });

  it("only accepts well-formed owner-scoped keys", () => {
    const ok = newKey("originals", "clzzzzzzzzzzzzzzzzzz", "image/jpeg");
    expect(parseKey(ok)).toMatchObject({ kind: "originals", ownerId: "clzzzzzzzzzzzzzzzzzz", ext: "jpg", contentType: "image/jpeg" });
    expect(parseKey("../etc/passwd")).toBeNull();
    expect(parseKey("originals/clzzzzzzzzzzzzzzzzzz/../x.jpg")).toBeNull();
    expect(parseKey("secrets/clzzzzzzzzzzzzzzzzzz/abcdefabcdef.jpg")).toBeNull();
    expect(() => newKey("originals", "clzzzzzzzzzzzzzzzzzz", "text/html")).toThrow();
  });

  it("round-trips put/get/exists/delete", async () => {
    const key = newKey("cutouts", "clzzzzzzzzzzzzzzzzzz", "image/png");
    await putObject(key, Buffer.from("png-bytes"), "image/png");
    expect(await objectExists(key)).toBe(true);
    const got = await getObject(key);
    expect(got.body.toString()).toBe("png-bytes");
    expect(got.contentType).toBe("image/png");
    await deleteObject(key);
    expect(await objectExists(key)).toBe(false);
    await expect(getObject(key)).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("signs uploads scoped to the owner and rejects tampering or expiry", async () => {
    const signed = await signUpload({ ownerId: "clzzzzzzzzzzzzzzzzzz", contentType: "image/jpeg" });
    expect(signed.key.startsWith("originals/clzzzzzzzzzzzzzzzzzz/")).toBe(true);
    expect(signed.method).toBe("PUT");
    const u = new URL(signed.url, "http://localhost");
    const exp = Number(u.searchParams.get("exp"));
    const sig = u.searchParams.get("sig")!;
    expect(verifyUploadToken(signed.key, "image/jpeg", exp, sig)).toBe(true);
    expect(verifyUploadToken(signed.key, "image/png", exp, sig)).toBe(false);
    expect(verifyUploadToken(signed.key.replace("clzzzzzzzzzzzzzzzzzz", "clyyyyyyyyyyyyyyyyyy"), "image/jpeg", exp, sig)).toBe(false);
    expect(verifyUploadToken(signed.key, "image/jpeg", exp - 10_000, sig)).toBe(false);
    expect(verifyUploadToken(signed.key, "image/jpeg", exp, sig.slice(0, -1) + "x")).toBe(false);
  });
});

describe("photo visibility", () => {
  beforeEach(async () => { await resetDb(); process.env.DEV_MODE = "true"; await seed(); });

  async function people() {
    const [avery, blake, casey, devon] = await Promise.all(
      ["avery@example.test", "blake", "casey", "devon"].map((q) =>
        q.includes("@") ? db.person.findUniqueOrThrow({ where: { email: q } }) : db.person.findFirstOrThrow({ where: { name: { contains: q, mode: "insensitive" } } })),
    );
    return { avery, blake, casey, devon };
  }

  it("owner and parents see everything of a minor; siblings see only confirmed item photos, never worn", async () => {
    const { avery, casey, devon } = await people();
    const original = newKey("originals", devon.id, "image/jpeg");
    const worn = newKey("worn", devon.id, "image/jpeg");
    const cutout = newKey("cutouts", devon.id, "image/png");
    // unconfirmed upload: owner + parent only
    expect(await canViewKey(devon, original)).toBe(true);
    expect(await canViewKey(avery, original)).toBe(true);
    expect(await canViewKey(casey, original)).toBe(false);
    // confirmed item with an alone cutout and a worn photo
    const item = await db.item.create({ data: { ownerId: devon.id, name: "Hoodie", photos: { create: [{ kind: "cutout", bucketKey: cutout }, { kind: "worn", bucketKey: worn }, { kind: "alone", bucketKey: original }] } } });
    expect(item.id).toBeTruthy();
    expect(await canViewKey(casey, cutout)).toBe(true);
    expect(await canViewKey(casey, original)).toBe(true);
    expect(await canViewKey(casey, worn)).toBe(false);
    expect(await canViewKey(avery, worn)).toBe(true);
    expect(await canViewKey(devon, worn)).toBe(true);
  });

  it("an adult's confirmed photos, worn included, are visible to the family; malformed keys never are", async () => {
    const { avery, casey, devon } = await people();
    const worn = newKey("worn", avery.id, "image/jpeg");
    expect(await canViewKey(casey, worn)).toBe(false);
    await db.item.create({ data: { ownerId: avery.id, name: "Blazer", photos: { create: [{ kind: "worn", bucketKey: worn }] } } });
    expect(await canViewKey(casey, worn)).toBe(true);
    expect(await canViewKey(devon, worn)).toBe(true);
    expect(await canViewKey(casey, "../../etc/passwd")).toBe(false);
    expect(await canViewKey({ ...casey, status: "removed" }, worn)).toBe(false);
  });
});

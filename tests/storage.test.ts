import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { resetDb } from "./helpers";
import { seed } from "../prisma/seed";
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
    const [jeff, brittney, olivia, mya] = await Promise.all(
      ["jeff@everbowl.com", "brittney", "olivia", "mya"].map((q) =>
        q.includes("@") ? db.person.findUniqueOrThrow({ where: { email: q } }) : db.person.findFirstOrThrow({ where: { name: { contains: q, mode: "insensitive" } } })),
    );
    return { jeff, brittney, olivia, mya };
  }

  it("owner and parents see everything of a minor; siblings see only confirmed item photos, never worn", async () => {
    const { jeff, olivia, mya } = await people();
    const original = newKey("originals", mya.id, "image/jpeg");
    const worn = newKey("worn", mya.id, "image/jpeg");
    const cutout = newKey("cutouts", mya.id, "image/png");
    // unconfirmed upload: owner + parent only
    expect(await canViewKey(mya, original)).toBe(true);
    expect(await canViewKey(jeff, original)).toBe(true);
    expect(await canViewKey(olivia, original)).toBe(false);
    // confirmed item with an alone cutout and a worn photo
    const item = await db.item.create({ data: { ownerId: mya.id, name: "Hoodie", photos: { create: [{ kind: "cutout", bucketKey: cutout }, { kind: "worn", bucketKey: worn }, { kind: "alone", bucketKey: original }] } } });
    expect(item.id).toBeTruthy();
    expect(await canViewKey(olivia, cutout)).toBe(true);
    expect(await canViewKey(olivia, original)).toBe(true);
    expect(await canViewKey(olivia, worn)).toBe(false);
    expect(await canViewKey(jeff, worn)).toBe(true);
    expect(await canViewKey(mya, worn)).toBe(true);
  });

  it("an adult's confirmed photos, worn included, are visible to the family; malformed keys never are", async () => {
    const { jeff, olivia, mya } = await people();
    const worn = newKey("worn", jeff.id, "image/jpeg");
    expect(await canViewKey(olivia, worn)).toBe(false);
    await db.item.create({ data: { ownerId: jeff.id, name: "Blazer", photos: { create: [{ kind: "worn", bucketKey: worn }] } } });
    expect(await canViewKey(olivia, worn)).toBe(true);
    expect(await canViewKey(mya, worn)).toBe(true);
    expect(await canViewKey(olivia, "../../etc/passwd")).toBe(false);
    expect(await canViewKey({ ...olivia, status: "removed" }, worn)).toBe(false);
  });
});

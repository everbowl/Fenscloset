import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { DEV_PASSWORD } from "../../prisma/seed-data";

describe("password hashing", () => {
  it("produces a different hash each time and verifies the right password", async () => {
    const a = await hashPassword(DEV_PASSWORD);
    const b = await hashPassword(DEV_PASSWORD);
    expect(a).not.toEqual(b);
    expect(a.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(a, DEV_PASSWORD)).toBe(true);
    expect(await verifyPassword(a, "0536")).toBe(false);
  });

  it("returns false for garbage hashes instead of throwing", async () => {
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});

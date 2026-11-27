import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("produces a different hash each time and verifies the right password", async () => {
    const a = await hashPassword("a-synthetic-password-1");
    const b = await hashPassword("a-synthetic-password-1");
    expect(a).not.toEqual(b);
    expect(a.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(a, "a-synthetic-password-1")).toBe(true);
    expect(await verifyPassword(a, "a-synthetic-password-2")).toBe(false);
  });

  it("returns false for garbage hashes instead of throwing", async () => {
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});

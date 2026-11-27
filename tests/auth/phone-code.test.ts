import { beforeEach, describe, expect, it, vi } from "vitest";
import { CODE_TTL_MS, createPhoneCode, redeemPhoneCode, resetPhoneCodes } from "@/lib/auth/phone-code";

describe("sign in on another phone: six digits, ten minutes, once", () => {
  beforeEach(() => { resetPhoneCodes(); vi.useRealTimers(); });

  it("a code signs in its person exactly once", () => {
    const { code, expiresAt } = createPhoneCode("person-a");
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(CODE_TTL_MS - 2000);
    expect(redeemPhoneCode(`${code.slice(0, 3)} ${code.slice(3)}`)).toEqual({ ok: true, personId: "person-a" }); // spaces are fine
    expect(redeemPhoneCode(code)).toEqual({ ok: false });
  });

  it("rejects wrong, short and expired codes; a new code retires the person's old one", () => {
    vi.useFakeTimers();
    const a = createPhoneCode("person-a");
    expect(redeemPhoneCode("12")).toEqual({ ok: false });
    expect(redeemPhoneCode(a.code === "000000" ? "000001" : "000000")).toEqual({ ok: false });
    const b = createPhoneCode("person-a");
    expect(redeemPhoneCode(a.code)).toEqual({ ok: false });
    vi.advanceTimersByTime(CODE_TTL_MS + 1000);
    expect(redeemPhoneCode(b.code)).toEqual({ ok: false });
  });
});

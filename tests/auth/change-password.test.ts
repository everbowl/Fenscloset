import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetDb, seed } from "../helpers";
import { FIXTURE_ADMIN_EMAIL } from "../fixtures/people-data";
import { setPassword } from "@/lib/auth/change-password";
import { createResetToken, consumeResetToken } from "@/lib/auth/reset";
import { login } from "@/lib/auth/login";

vi.mock("server-only", () => ({}));
let me: { id: string } | null = null;
vi.mock("@/lib/auth/current", () => ({ requirePerson: async () => db.person.findUniqueOrThrow({ where: { id: me!.id } }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
const sendEmail = vi.fn(async () => ({ sent: true }));
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<object>()), sendEmail: (...a: unknown[]) => sendEmail(...(a as [])) }));

const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };

describe("changing a password asks for the current one (security item 14)", () => {
  beforeEach(async () => { await resetDb(); await seed(); sendEmail.mockClear(); me = await db.person.findUniqueOrThrow({ where: { email: FIXTURE_ADMIN_EMAIL } }); await setPassword(me.id, "closet-rocks-2026"); });

  it("a normal session without the current password is refused; with it the change goes through and the person is told by mail", async () => {
    const { changePasswordAction } = await import("@/app/(auth)/change-password/actions");
    expect(await changePasswordAction({}, form({ password: "a-new-password-1" }))).toMatchObject({ error: expect.stringMatching(/current password/) });
    expect(await changePasswordAction({}, form({ password: "a-new-password-1", current: "not-the-password" }))).toMatchObject({ error: expect.stringMatching(/current password/) });
    expect((await login(FIXTURE_ADMIN_EMAIL, "closet-rocks-2026")).ok).toBe(true); // nothing changed
    await expect(changePasswordAction({}, form({ password: "a-new-password-1", current: "closet-rocks-2026" }))).rejects.toThrow("REDIRECT:/today");
    expect((await login(FIXTURE_ADMIN_EMAIL, "a-new-password-1")).ok).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("right after a reset link the person is in the forced-change state and sets a password without the old one", async () => {
    const created = await createResetToken(FIXTURE_ADMIN_EMAIL);
    expect(await consumeResetToken(created!.token, "from-the-link-1")).toMatchObject({ ok: true });
    await db.person.update({ where: { id: me!.id }, data: { mustChangePassword: true } }); // what an invite or a bootstrap link leaves behind
    const { changePasswordAction } = await import("@/app/(auth)/change-password/actions");
    await expect(changePasswordAction({}, form({ password: "chosen-after-reset-1" }))).rejects.toThrow("REDIRECT:/today");
    expect((await login(FIXTURE_ADMIN_EMAIL, "chosen-after-reset-1")).ok).toBe(true);
  });
});

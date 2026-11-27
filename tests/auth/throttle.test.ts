import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetDb, seed } from "../helpers";
import { FIXTURE_ADMIN_EMAIL } from "../fixtures/people-data";
import { setPassword } from "@/lib/auth/change-password";
import { login } from "@/lib/auth/login";
import { createResetToken, consumeResetToken } from "@/lib/auth/reset";
import { createPhoneCode, redeemPhoneCode, resetPhoneCodes, voidAllPhoneCodes } from "@/lib/auth/phone-code";
import { setRule } from "@/lib/rules";
import { accountKey, clientKey, countFailures, recordAttempt, sendAllowed, throttleRules, throttleStatus, THROTTLE_MINIMUMS } from "@/lib/auth/rate-limit";

// The server actions read the request through next/headers; here the headers are a forged client behind one trusted hop.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("server-only", () => ({}));
// Mail "works" and every send is counted, so the limits can be measured in sends.
const sendEmail = vi.fn(async () => ({ sent: true, id: "test" }));
vi.mock("@/lib/email", async (importOriginal) => ({ ...(await importOriginal<object>()), emailConfigured: () => true, sendEmail: (...args: unknown[]) => sendEmail(...(args as [])) }));

const PASSWORD = "closet-rocks-2026";
const ACCOUNT = accountKey(FIXTURE_ADMIN_EMAIL);
const CLIENT = clientKey(new Headers({ "x-forwarded-for": "203.0.113.9" }));

/** Moves every row of one kind back in time, so a wait can pass without waiting. */
async function backdate(kind: string, ms: number) {
  await db.$executeRawUnsafe(`UPDATE "AuthAttempt" SET "createdAt" = "createdAt" - make_interval(secs => ${Math.floor(ms / 1000)}) WHERE kind = $1`, kind);
}

describe("sign-in backoff (security item 6)", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
    await setPassword((await db.person.findUniqueOrThrow({ where: { email: FIXTURE_ADMIN_EMAIL } })).id, PASSWORD);
  });

  it("the client key is the right-most forwarded hop; a forged first value changes nothing; no header is one shared bucket", () => {
    const trusted = clientKey(new Headers({ "x-forwarded-for": "203.0.113.9" }));
    expect(clientKey(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe(trusted);
    expect(clientKey(new Headers({ "x-forwarded-for": "evil, 1.2.3.4, 203.0.113.9" }))).toBe(trusted);
    expect(clientKey(new Headers({ "x-forwarded-for": "6.6.6.6" }))).not.toBe(trusted);
    expect(clientKey(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("unknown"); // only the proxy's hop counts
    expect(clientKey(new Headers())).toBe("unknown");
    expect(trusted).not.toContain("203"); // a hash, never the address itself
  });

  it("the rules carry floors an admin cannot go under, and nothing sits in code as a constant", async () => {
    const before = await throttleRules();
    expect(before.authFailuresBeforeWait).toBe(5);
    await setRule("authFailuresBeforeWait", "1"); // an admin tries to switch the limit off
    expect((await throttleRules()).authFailuresBeforeWait).toBe(THROTTLE_MINIMUMS.authFailuresBeforeWait);
    await setRule("authFailuresBeforeWait", "8");
    expect((await throttleRules()).authFailuresBeforeWait).toBe(8);
  });

  it("N+1 wrong passwords: the next try waits even with the right password; after the wait the right password works; the wait doubles", async () => {
    const { authFailuresBeforeWait: n, authFirstWaitSeconds: first } = await throttleRules();
    for (let i = 0; i < n; i++) {
      expect((await throttleStatus("login", ACCOUNT, CLIENT)).ok).toBe(true);
      expect(await login(FIXTURE_ADMIN_EMAIL, "wrong-password-" + i)).toEqual({ ok: false });
      await recordAttempt("login", ACCOUNT, CLIENT, false);
    }
    const refused = await throttleStatus("login", ACCOUNT, CLIENT);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.waitSeconds).toBeGreaterThan(0);
    expect(refused.ok === false && refused.waitSeconds <= first).toBe(true);
    // a try during the wait is not recorded, so the wait does not stretch
    expect(await db.authAttempt.count({ where: { kind: "login", ok: false } })).toBe(n);
    // the wait passes
    await backdate("login", (first + 1) * 1000);
    expect((await throttleStatus("login", ACCOUNT, CLIENT)).ok).toBe(true);
    // one more failure doubles the wait, counted from that failure
    await recordAttempt("login", ACCOUNT, CLIENT, false);
    const again = await throttleStatus("login", ACCOUNT, CLIENT);
    expect(again.ok === false && again.waitSeconds > first && again.waitSeconds <= first * 2).toBe(true);
    // a success clears the count
    await recordAttempt("login", ACCOUNT, CLIENT, true);
    expect((await throttleStatus("login", ACCOUNT, CLIENT)).ok).toBe(true);
    expect(await db.authAttempt.count({ where: { kind: "login", accountKey: ACCOUNT, ok: false } })).toBe(0);
  });

  it("a reset link used during the backoff signs in and clears it", async () => {
    const { authFailuresBeforeWait: n } = await throttleRules();
    for (let i = 0; i < n + 2; i++) await recordAttempt("login", ACCOUNT, CLIENT, false);
    expect((await throttleStatus("login", ACCOUNT, CLIENT)).ok).toBe(false);
    const created = await createResetToken(FIXTURE_ADMIN_EMAIL);
    expect(await consumeResetToken(created!.token, "a-new-password-after-reset-1")).toMatchObject({ ok: true });
    expect((await throttleStatus("login", ACCOUNT, CLIENT)).ok).toBe(true);
    expect((await login(FIXTURE_ADMIN_EMAIL, "a-new-password-after-reset-1")).ok).toBe(true);
  });

  it("the per-client ceiling waits too, across accounts, with the same backoff", async () => {
    const { authClientFailuresPerHour: ceiling } = await throttleRules();
    for (let i = 0; i < ceiling; i++) await recordAttempt("login", accountKey(`victim-${i}@example.test`), CLIENT, false);
    expect((await throttleStatus("login", accountKey("someone-new@example.test"), CLIENT)).ok).toBe(false);
    expect((await throttleStatus("login", accountKey("someone-new@example.test"), clientKey(new Headers({ "x-forwarded-for": "198.51.100.7" })))).ok).toBe(true);
  });

  it("the sign-in action refuses a try during the wait with the same words as a wrong password", async () => {
    const { loginAction } = await import("@/app/(auth)/login/actions");
    const form = (password: string) => { const f = new FormData(); f.set("email", FIXTURE_ADMIN_EMAIL); f.set("password", password); return f; };
    const { authFailuresBeforeWait: n } = await throttleRules();
    let wrong = "";
    for (let i = 0; i < n; i++) wrong = (await loginAction({}, form("wrong-password-" + i))).error ?? "";
    expect(wrong).toMatch(/don't match/);
    const during = await loginAction({}, form(PASSWORD)); // the right password, during the wait
    expect(during.error).toBe(wrong);
  });
});

describe("reset mails and invite sends (security item 6)", () => {
  beforeEach(async () => { await resetDb(); await seed(); delete process.env.RESEND_API_KEY; });

  it("forgot password answers the same for a known and an unknown address, and sends at most the allowed number", async () => {
    sendEmail.mockClear();
    const { forgotPasswordAction } = await import("@/app/(auth)/forgot-password/actions");
    const form = (email: string) => { const f = new FormData(); f.set("email", email); return f; };
    const known = await forgotPasswordAction({}, form(FIXTURE_ADMIN_EMAIL));
    const unknown = await forgotPasswordAction({}, form("nobody@example.com"));
    expect(known).toEqual({ done: true, email: FIXTURE_ADMIN_EMAIL });
    expect(unknown).toEqual({ done: true, email: "nobody@example.com" });
    expect(sendEmail).toHaveBeenCalledTimes(1); // one mail, to the known address only
    // hammering the known address: the answer never changes, and no further mail goes out inside the cooldown
    for (let i = 0; i < 5; i++) expect(await forgotPasswordAction({}, form(FIXTURE_ADMIN_EMAIL))).toEqual({ done: true, email: FIXTURE_ADMIN_EMAIL });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const r = await throttleRules();
    await backdate("forgot", (r.forgotPerAccountMinutes + 1) * 60_000);
    await forgotPasswordAction({}, form(FIXTURE_ADMIN_EMAIL));
    expect(sendEmail).toHaveBeenCalledTimes(2); // the cooldown passed: one more
  });

  it("one reset mail per address per cooldown, a few per hour, and a ceiling per client", async () => {
    const r = await throttleRules();
    const acct = accountKey(FIXTURE_ADMIN_EMAIL);
    expect(await sendAllowed("forgot", acct, CLIENT)).toBe(true);
    await recordAttempt("forgot", acct, CLIENT, true);
    expect(await sendAllowed("forgot", acct, CLIENT)).toBe(false); // the cooldown
    await backdate("forgot", (r.forgotPerAccountMinutes + 1) * 60_000);
    expect(await sendAllowed("forgot", acct, CLIENT)).toBe(true);
    for (let i = 1; i < r.forgotPerAccountPerHour; i++) { await recordAttempt("forgot", acct, CLIENT, true); await backdate("forgot", (r.forgotPerAccountMinutes + 1) * 60_000); }
    expect(await sendAllowed("forgot", acct, CLIENT)).toBe(false); // the hourly ceiling for the address
    expect(await sendAllowed("forgot", accountKey("other@example.test"), CLIENT)).toBe(true); // another address is fine
    for (let i = 0; i < r.forgotPerClientPerHour; i++) await recordAttempt("forgot", accountKey(`addr-${i}@example.test`), CLIENT, true);
    expect(await sendAllowed("forgot", accountKey("yet-another@example.test"), CLIENT)).toBe(false); // the client ceiling
  });

  it("invite sends: a cooldown per contact and a daily ceiling", async () => {
    const r = await throttleRules();
    const contact = accountKey("new-member@example.test");
    expect(await sendAllowed("invite_send", contact, CLIENT)).toBe(true);
    await recordAttempt("invite_send", contact, CLIENT, true);
    expect(await sendAllowed("invite_send", contact, CLIENT)).toBe(false);
    await backdate("invite_send", (r.inviteResendMinutes + 1) * 60_000);
    expect(await sendAllowed("invite_send", contact, CLIENT)).toBe(true);
    for (let i = 1; i < r.inviteSendsPerDay; i++) { await recordAttempt("invite_send", contact, CLIENT, true); await backdate("invite_send", (r.inviteResendMinutes + 1) * 60_000); }
    expect(await sendAllowed("invite_send", contact, CLIENT)).toBe(false);
  });
});

describe("second-phone code guesses (security item 6)", () => {
  beforeEach(async () => { await resetDb(); await seed(); resetPhoneCodes(); });

  it("after the guess budget every live code is voided, so a six-digit code cannot be guessed", async () => {
    const r = await throttleRules();
    const admin = await db.person.findUniqueOrThrow({ where: { email: FIXTURE_ADMIN_EMAIL } });
    const { code } = createPhoneCode(admin.id);
    for (let i = 0; i < r.codeGuessesBeforeReset; i++) await recordAttempt("code", "code", CLIENT, false);
    expect(await countFailures("code", r.authWindowMinutes * 60_000)).toBe(r.codeGuessesBeforeReset);
    voidAllPhoneCodes(); // what the action does at the budget
    expect(redeemPhoneCode(code)).toEqual({ ok: false });
    expect((await throttleStatus("code", "code", CLIENT)).ok).toBe(false); // and the client is in a backoff
  });

  it("old rows are pruned after a day", async () => {
    await recordAttempt("login", ACCOUNT, CLIENT, false);
    await backdate("login", 25 * 3_600_000);
    await recordAttempt("login", accountKey("x@example.test"), CLIENT, false);
    expect(await db.authAttempt.count()).toBe(1);
  });
});

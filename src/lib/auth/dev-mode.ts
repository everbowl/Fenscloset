/**
 * DEV MODE: while DEV_MODE=true, the dev admin (DEV_ADMIN_EMAIL) may sign in once with the one-time dev value
 * (DEV_PASSWORD in prisma/seed-data.ts). After that single sign-in the account is forced to a new password. With
 * DEV_MODE off, or no DEV_ADMIN_EMAIL set, the path is closed. Security item 3 removes this module altogether.
 */
/** The one account the one-time dev value may sign in: set by the test and e2e harness; unset in production (closed). */
export const DEV_ADMIN_EMAIL: string | null = process.env.DEV_ADMIN_EMAIL ?? null;

export function isDevMode(): boolean {
  return process.env.DEV_MODE === "true";
}

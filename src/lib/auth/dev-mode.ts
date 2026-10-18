/**
 * DEV MODE (per Jeff's rules): while DEV_MODE=true, jeff@everbowl.com may log in once with 0535.
 * After that single login the account is forced to a new password. When DEV_MODE is false the
 * 0535 path is disabled entirely, even on a fresh seed.
 */
export const DEV_ADMIN_EMAIL = "jeff@everbowl.com";

export function isDevMode(): boolean {
  return process.env.DEV_MODE === "true";
}

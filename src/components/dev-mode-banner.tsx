import { db } from "@/lib/db";
import { DEV_ADMIN_EMAIL, isDevMode } from "@/lib/auth/dev-mode";
import { Banner } from "@/components/ui/banner";

/** Shown on the site while the one-time DEV password is live. Renders nothing otherwise. */
export async function DevModeBanner() {
  if (!isDevMode()) return null;
  let active = false;
  try {
    const jeff = await db.person.findUnique({ where: { email: DEV_ADMIN_EMAIL }, select: { devPasswordActive: true } });
    active = Boolean(jeff?.devPasswordActive);
  } catch (e) {
    // A banner must never take the login page down with it (e.g. database briefly unreachable).
    console.error("[dev-mode-banner] could not read Person", e);
    return null;
  }
  if (!active) return null;
  return (
    <Banner tone="danger" title="DEV password 0535 is active" className="rounded-none border-x-0">
      It works for exactly one login as {DEV_ADMIN_EMAIL}. Change it right after signing in.
    </Banner>
  );
}

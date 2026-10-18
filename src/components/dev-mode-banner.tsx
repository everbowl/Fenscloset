import { db } from "@/lib/db";
import { DEV_ADMIN_EMAIL, isDevMode } from "@/lib/auth/dev-mode";
import { Banner } from "@/components/ui/banner";

/** Shown on the site while the one-time DEV password is live. Renders nothing otherwise. */
export async function DevModeBanner() {
  if (!isDevMode()) return null;
  const jeff = await db.person.findUnique({ where: { email: DEV_ADMIN_EMAIL }, select: { devPasswordActive: true } });
  if (!jeff?.devPasswordActive) return null;
  return (
    <Banner tone="danger" title="DEV password 0535 is active" className="rounded-none border-x-0">
      It works for exactly one login as {DEV_ADMIN_EMAIL}. Change it right after signing in.
    </Banner>
  );
}

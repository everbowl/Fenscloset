import { db } from "@/lib/db";
import { DEV_ADMIN_EMAIL, isDevMode } from "@/lib/auth/dev-mode";

/** The black DEV strip from the sign-in mockup. Shown only while the one-time 0535 password is live. */
export async function DevModeBanner() {
  if (!isDevMode()) return null;
  let active = false;
  try {
    const jeff = await db.person.findUnique({ where: { email: DEV_ADMIN_EMAIL }, select: { devPasswordActive: true } });
    active = Boolean(jeff?.devPasswordActive);
  } catch (e) {
    console.error("[dev-mode-banner] could not read Person", e);
    return null;
  }
  if (!active) return null;
  return (
    <div role="alert" className="mono flex h-[30px] items-center justify-center bg-ink text-paper">
      Dev mode · one-time admin password active
    </div>
  );
}

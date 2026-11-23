import { devPasswordLive } from "@/lib/auth/dev-banner";

/** The black DEV strip from the sign-in mockup. Shown only while the one-time 0535 password is live. */
export async function DevModeBanner() {
  let active = false;
  try {
    active = await devPasswordLive();
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

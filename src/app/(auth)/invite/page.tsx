import Link from "next/link";
import { AuthHero } from "@/components/auth-hero";

export const metadata = { title: "I have an invite" };

/** Landing for people who tap "I have an invite" without the link handy. */
export default function InviteHelpPage() {
  return (
    <>
      <AuthHero />
      <main className="flex flex-1 flex-col gap-5 px-6 pb-7 pt-7">
        <h1 className="serif text-[34px]">Got an <em>invite?</em></h1>
        <p className="text-[15px] leading-snug">Open the link from your email or text message. It sets up your password and your own closet in one step.</p>
        <p className="text-[15px] leading-snug text-graphite">Don&apos;t have one? Ask Jeff or Brittney to send it from People in the app.</p>
        <Link href="/login" className="mono mono-11 py-2.5 underline underline-offset-4">Back to sign in</Link>
      </main>
    </>
  );
}

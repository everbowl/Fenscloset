import Link from "next/link";
import { AuthHero } from "@/components/auth-hero";

export const metadata = { title: "I have an invite" };

/** Landing for people who tap "I have an invite" without the link handy. */
export default function InviteHelpPage() {
  return (
    <>
      <AuthHero />
      <main className="safe-bottom flex flex-1 flex-col gap-6 px-6 pb-7 pt-7">
        <div className="flex flex-col gap-1.5">
          <h1 className="title">Got an invite?</h1>
          <p className="note">Open the link from your email or text message. It sets up your password and your own closet in one step.</p>
        </div>
        <div className="card p-4">
          <p className="text-[15px] leading-snug">Don&apos;t have one? Ask a family admin to send it from People in the app.</p>
        </div>
        <Link href="/login" className="pill pill-quiet h-12 w-full">Back to sign in</Link>
      </main>
    </>
  );
}

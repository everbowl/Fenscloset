import Link from "next/link";
import { peekInvite } from "@/lib/auth/invite";
import { AuthHero } from "@/components/auth-hero";
import { AcceptForm } from "./form";

export const metadata = { title: "You're invited" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await peekInvite(token);
  return (
    <>
      <AuthHero />
      <main className="safe-bottom flex flex-1 flex-col gap-6 px-6 pb-7 pt-7">
        {!invite ? (
          <>
            <div className="flex flex-col gap-1.5" role="alert">
              <h1 className="title">This invite doesn&apos;t work anymore</h1>
              <p className="note">It expired (invites last 7 days) or was already used. Ask an admin to send a new one.</p>
            </div>
            <Link href="/login" className="pill pill-solid h-12 w-full">Go to sign in</Link>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <h1 className="serif text-[38px]">Welcome, {invite.name.split(" ")[0]}</h1>
              <p className="note">Set a password and your closet is ready.</p>
            </div>
            <AcceptForm token={token} name={invite.name} email={invite.email} />
          </>
        )}
      </main>
    </>
  );
}

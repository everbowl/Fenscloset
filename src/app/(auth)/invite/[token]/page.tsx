import Link from "next/link";
import { peekInvite } from "@/lib/auth/invite";
import { Banner } from "@/components/ui/banner";
import { AuthHero } from "@/components/auth-hero";
import { AcceptForm } from "./form";

export const metadata = { title: "You're invited" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await peekInvite(token);
  return (
    <>
      <AuthHero />
      <main className="flex flex-1 flex-col gap-[22px] px-6 pb-7 pt-7">
        {!invite ? (
          <>
            <Banner tone="danger" title="This invite doesn't work anymore">It expired (invites last 7 days) or was already used. Ask an admin to send a new one.</Banner>
            <Link href="/login" className="mono mono-11 py-2.5 underline underline-offset-4">Go to sign in</Link>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="serif text-[38px]">Welcome, <em>{invite.name.split(" ")[0]}</em></h1>
              <p className="mono mono-11 text-graphite">Set a password and your closet is ready</p>
            </div>
            <AcceptForm token={token} name={invite.name} email={invite.email} />
          </>
        )}
      </main>
    </>
  );
}

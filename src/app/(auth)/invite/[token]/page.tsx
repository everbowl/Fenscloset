import Link from "next/link";
import { peekInvite } from "@/lib/auth/invite";
import { Banner } from "@/components/ui/banner";
import { AcceptForm } from "./form";

export const metadata = { title: "You're invited" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await peekInvite(token);
  if (!invite) {
    return (
      <div className="space-y-4">
        <Banner tone="danger" title="This invite doesn't work anymore">It expired (invites last 7 days) or was already used. Ask an admin to send a new one.</Banner>
        <Link href="/login" className="block text-center text-sm font-medium text-accent">Go to sign in</Link>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome, {invite.name.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-muted">Set a password and your closet is ready.</p>
      </div>
      <AcceptForm token={token} name={invite.name} email={invite.email} />
    </div>
  );
}

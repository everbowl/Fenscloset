import Link from "next/link";
import { requirePerson, getCurrentSession } from "@/lib/auth/current";
import { hasUsablePassword } from "@/lib/auth/login";
import { AuthHero } from "@/components/auth-hero";
import { logoutAction } from "@/app/(auth)/login/actions";
import { ChangePasswordForm } from "./form";

export const metadata = { title: "Set a new password" };

export default async function ChangePasswordPage() {
  const person = await requirePerson();
  const session = await getCurrentSession();
  // With 0535 spent and no real password saved yet there is nothing to sign back in with, so no way out is offered here
  // (review A A2): the one move is to set the password.
  const canLeave = hasUsablePassword(person);
  return (
    <>
      <AuthHero />
      <main className="safe-bottom flex flex-1 flex-col gap-6 px-6 pb-7 pt-7">
        {session?.usedDevPassword ? (
          <div role="alert" className="card bg-bone p-4">
            <p className="text-[15px] font-semibold">You signed in with the one-time DEV password</p>
            <p className="note mt-1">0535 is now disabled. Set your real password to continue; until you do, no other phone can sign in.</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <h1 className="title">{person.mustChangePassword ? "Set a new password" : "Change password"}</h1>
          <p className="note">Signed in as {person.email}</p>
        </div>
        <ChangePasswordForm email={person.email ?? ""} />
        {!person.mustChangePassword
          ? <Link href="/profile/settings" className="pill pill-quiet h-12 w-full" data-testid="change-password-cancel">Cancel</Link>
          : canLeave
            ? <form action={logoutAction}><button type="submit" className="pill pill-quiet h-12 w-full" data-testid="change-password-signout">Sign out instead</button></form>
            : <p className="caption text-center">Signing out now would leave the account with no password at all, so finish this step first.</p>}
      </main>
    </>
  );
}

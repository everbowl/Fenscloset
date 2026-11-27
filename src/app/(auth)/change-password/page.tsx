import Link from "next/link";
import { requirePerson } from "@/lib/auth/current";
import { hasUsablePassword } from "@/lib/auth/login";
import { AuthHero } from "@/components/auth-hero";
import { logoutAction } from "@/app/(auth)/login/actions";
import { ChangePasswordForm } from "./form";

export const metadata = { title: "Set a new password" };

export default async function ChangePasswordPage() {
  const person = await requirePerson();
  // After a reset link or an invite there may be no password to sign back in with, so no way out is offered then (review
  // A A2): the one move is to set the password.
  const canLeave = hasUsablePassword(person);
  return (
    <>
      <AuthHero />
      <main className="safe-bottom flex flex-1 flex-col gap-6 px-6 pb-7 pt-7">
        <div className="flex flex-col gap-1.5">
          <h1 className="title">{person.mustChangePassword ? "Set a new password" : "Change password"}</h1>
          <p className="note">Signed in as {person.email}</p>
        </div>
        <ChangePasswordForm email={person.email ?? ""} askCurrent={!person.mustChangePassword} />
        {!person.mustChangePassword ? <p className="note">Forgot the current one? Sign out and use Forgot password on the sign-in page.</p> : null}
        {!person.mustChangePassword
          ? <Link href="/profile/settings" className="pill pill-quiet h-12 w-full" data-testid="change-password-cancel">Cancel</Link>
          : canLeave
            ? <form action={logoutAction}><button type="submit" className="pill pill-quiet h-12 w-full" data-testid="change-password-signout">Sign out instead</button></form>
            : <p className="caption text-center">Signing out now would leave the account with no password at all, so finish this step first.</p>}
      </main>
    </>
  );
}

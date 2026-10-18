import { requirePerson, getCurrentSession } from "@/lib/auth/current";
import { Banner } from "@/components/ui/banner";
import { AuthHero } from "@/components/auth-hero";
import { ChangePasswordForm } from "./form";

export const metadata = { title: "Set a new password" };

export default async function ChangePasswordPage() {
  const person = await requirePerson();
  const session = await getCurrentSession();
  return (
    <>
      <AuthHero />
      <main className="flex flex-1 flex-col gap-[22px] px-6 pb-7 pt-7">
        {session?.usedDevPassword ? (
          <Banner tone="danger" title="You signed in with the one-time DEV password">0535 is now disabled. Set your real password to continue.</Banner>
        ) : null}
        <div className="flex flex-col gap-1">
          <h1 className="serif text-[34px]">{person.mustChangePassword ? <>Set a new <em>password</em></> : <>Change <em>password</em></>}</h1>
          <p className="mono mono-11 normal-case text-graphite">Signed in as {person.email}</p>
        </div>
        <ChangePasswordForm />
      </main>
    </>
  );
}

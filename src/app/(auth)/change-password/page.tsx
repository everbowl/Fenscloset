import { requirePerson, getCurrentSession } from "@/lib/auth/current";
import { Banner } from "@/components/ui/banner";
import { ChangePasswordForm } from "./form";

export const metadata = { title: "Set a new password" };

export default async function ChangePasswordPage() {
  const person = await requirePerson();
  const session = await getCurrentSession();
  return (
    <div>
      {session?.usedDevPassword ? (
        <Banner tone="danger" title="You signed in with the one-time DEV password" className="mb-6">
          0535 is now disabled. Set your real password to continue.
        </Banner>
      ) : null}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{person.mustChangePassword ? "Set a new password" : "Change password"}</h1>
        <p className="mt-1 text-sm text-muted">Signed in as {person.email}</p>
      </div>
      <ChangePasswordForm />
    </div>
  );
}

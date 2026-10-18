import { redirect } from "next/navigation";
import { requirePerson, isAdmin } from "@/lib/auth/current";
import { AppNav } from "@/components/app-nav";
import { AppHeader } from "@/components/app-header";
import { PersonMenu } from "@/components/person-menu";
import { DevModeBanner } from "@/components/dev-mode-banner";
import { ServiceWorkerRegistrar } from "@/components/sw-registrar";
import { logoutAction } from "@/app/(auth)/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const person = await requirePerson();
  if (person.mustChangePassword) redirect("/change-password");
  return (
    <div className="min-h-dvh bg-paper">
      <ServiceWorkerRegistrar />
      {isAdmin(person) ? <DevModeBanner /> : null}
      <AppHeader left={<PersonMenu name={person.name} isAdmin={isAdmin(person)} logout={logoutAction} />} />
      <main className="mx-auto w-full max-w-[480px] px-5 pb-28 pt-5">{children}</main>
      <AppNav />
    </div>
  );
}

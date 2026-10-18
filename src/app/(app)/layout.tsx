import { redirect } from "next/navigation";
import { requirePerson } from "@/lib/auth/current";
import { AppNav } from "@/components/app-nav";
import { DevModeBanner } from "@/components/dev-mode-banner";
import { ServiceWorkerRegistrar } from "@/components/sw-registrar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const person = await requirePerson();
  if (person.mustChangePassword) redirect("/change-password");
  return (
    <div className="min-h-dvh md:pl-56">
      <ServiceWorkerRegistrar />
      {person.role === "admin" ? <DevModeBanner /> : null}
      <main className="safe-top mx-auto w-full max-w-3xl px-4 pb-24 pt-5 md:px-8 md:pb-10 md:pt-8">{children}</main>
      <AppNav />
    </div>
  );
}

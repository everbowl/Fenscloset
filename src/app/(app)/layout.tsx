import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requirePerson, isAdmin } from "@/lib/auth/current";
import { resolveView, viewableClosets, VIEW_COOKIE } from "@/lib/people/visibility";
import { AppNav } from "@/components/app-nav";
import { AppHeader } from "@/components/app-header";
import { PersonMenu } from "@/components/person-menu";
import { HeaderActionSlot } from "@/components/header-action";
import { DevModeBanner } from "@/components/dev-mode-banner";
import { ServiceWorkerRegistrar } from "@/components/sw-registrar";
import { logoutAction } from "@/app/(auth)/login/actions";
import { setViewAction } from "./view-actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const person = await requirePerson();
  if (person.mustChangePassword) redirect("/change-password");
  const cookieView = (await cookies()).get(VIEW_COOKIE)?.value;
  const [views, view] = await Promise.all([viewableClosets(person), resolveView(person, cookieView)]);
  const current = view.kind === "family" ? "family" : view.personId;
  return (
    <div className="min-h-dvh bg-paper">
      <ServiceWorkerRegistrar />
      <DevModeBanner />
      <AppHeader left={<PersonMenu views={views} current={current} isAdmin={isAdmin(person)} logout={logoutAction} setView={setViewAction} />} right={<HeaderActionSlot />} />
      <main className="mx-auto w-full max-w-[480px] px-5 pb-28 pt-5">{children}</main>
      <AppNav />
    </div>
  );
}

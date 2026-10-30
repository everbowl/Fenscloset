import { cookies } from "next/headers";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requirePerson, isAdmin } from "@/lib/auth/current";
import { resolveView, viewableClosets, VIEW_COOKIE } from "@/lib/people/visibility";
import { AppNav } from "@/components/app-nav";
import { AppHeader } from "@/components/app-header";
import { PersonMenu } from "@/components/person-menu";
import { HeaderBack } from "@/components/header-back";
import { accentColor } from "@/lib/rules";
import { HeaderActionSlot } from "@/components/header-action";
import { DevModeBanner } from "@/components/dev-mode-banner";
import { ServiceWorkerRegistrar } from "@/components/sw-registrar";
import { logoutAction } from "@/app/(auth)/login/actions";
import { setViewAction } from "./view-actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const person = await requirePerson();
  if (person.mustChangePassword) redirect("/change-password");
  const cookieView = (await cookies()).get(VIEW_COOKIE)?.value;
  const [views, view, accent] = await Promise.all([viewableClosets(person), resolveView(person, cookieView), accentColor()]);
  const current = view.kind === "family" ? "family" : view.personId;
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <style>{`:root{--accent:${accent}}`}</style>
      <ServiceWorkerRegistrar />
      <DevModeBanner />
      <AppHeader left={<div className="flex items-center"><Suspense><HeaderBack /></Suspense><PersonMenu views={views} current={current} isAdmin={isAdmin(person)} logout={logoutAction} setView={setViewAction} /></div>} right={<HeaderActionSlot />} />
      {/* Desktop (Q17): the tab row sits under the header; on phones it is the pinned bottom bar. */}
      <AppNav />
      <main className="mx-auto w-full max-w-[480px] px-5 pb-28 pt-5 lg:max-w-[1040px] lg:px-10 lg:pb-16 lg:pt-8">{children}</main>
    </div>
  );
}

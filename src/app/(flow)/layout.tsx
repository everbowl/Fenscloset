import { redirect } from "next/navigation";
import { requirePerson } from "@/lib/auth/current";
import { DevModeBanner } from "@/components/dev-mode-banner";

/** Full-screen flows (the add-item confirm step) have no header or nav, as drawn. */
export default async function FlowLayout({ children }: { children: React.ReactNode }) {
  const person = await requirePerson();
  if (person.mustChangePassword) redirect("/change-password");
  return (
    <div className="min-h-dvh bg-paper">
      <DevModeBanner />
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">{children}</main>
    </div>
  );
}

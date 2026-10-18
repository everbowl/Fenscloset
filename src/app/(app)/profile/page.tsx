import Link from "next/link";
import { ChevronRight, KeyRound, ListChecks, LogOut, SlidersHorizontal, Users } from "lucide-react";
import { requirePerson, isAdmin } from "@/lib/auth/current";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/login/actions";

export const metadata = { title: "Profile" };

const roleLabel = { admin: "Admin", member: "Member", minor: "Minor" } as const;

function Row({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="flex h-12 items-center gap-3 px-1 text-[15px] hover:bg-stone-50">
      <span className="text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight className="size-4 text-stone-400" />
    </Link>
  );
}

export default async function ProfilePage() {
  const person = await requirePerson();
  return (
    <div className="space-y-5">
      <PageHeader title={person.name} subtitle={`${person.email ?? "No email yet"} · ${roleLabel[person.role]}`} />
      <Card className="divide-y divide-border p-2">
        <Row href="/change-password" icon={<KeyRound className="size-5" />} label="Change password" />
      </Card>
      {isAdmin(person) ? (
        <section>
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">Admin</h2>
          <Card className="divide-y divide-border p-2">
            <Row href="/admin/people" icon={<Users className="size-5" />} label="People" />
            <Row href="/admin/lists" icon={<ListChecks className="size-5" />} label="Lists" />
            <Row href="/admin/rules" icon={<SlidersHorizontal className="size-5" />} label="Rules" />
          </Card>
        </section>
      ) : null}
      <form action={logoutAction}>
        <Button type="submit" variant="secondary" className="w-full"><LogOut className="size-4" /> Log out</Button>
      </form>
    </div>
  );
}

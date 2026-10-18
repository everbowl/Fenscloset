import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { listPeople } from "@/lib/people/service";
import { smsConfigured } from "@/lib/sms";
import { InviteSheet } from "./invite-sheet";

export const metadata = { title: "People" };

const roleLabel = { admin: "Admin", member: "Member", minor: "Minor" } as const;

export default async function PeoplePage() {
  const people = await listPeople();
  const admins = people.filter((p) => p.role === "admin").map((p) => ({ id: p.id, name: p.name }));
  return (
    <div>
      <PageHeader title="People" subtitle="Everyone with a closet. Admins can invite, change roles, and remove people." action={<InviteSheet admins={admins} smsReady={smsConfigured()} />} />
      <Card className="divide-y divide-border p-0">
        {people.map((p) => (
          <Link key={p.id} href={`/admin/people/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50">
            <span className="flex size-10 items-center justify-center rounded-full bg-amber-100 font-semibold text-amber-900">{p.name[0]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium">{p.name} <span className="ml-1 rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">{roleLabel[p.role]}</span></p>
              <p className="truncate text-sm text-muted">
                {p.email ?? "No email yet"}
                {p.hasPassword ? "" : p.pendingInvite ? " · Invite sent" : " · Needs an invite"}
                {p.devPasswordActive ? " · DEV password active" : ""}
              </p>
            </div>
            <ChevronRight className="size-4 text-stone-400" />
          </Link>
        ))}
      </Card>
    </div>
  );
}

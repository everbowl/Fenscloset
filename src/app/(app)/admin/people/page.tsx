import Link from "next/link";
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
      <PageHeader title="People" action={<InviteSheet admins={admins} smsReady={smsConfigured()} />} />
      <Card className="divide-y divide-line border-x-0 border-b-0 border-t border-ink p-0">
        {people.map((p) => (
          <Link key={p.id} href={`/admin/people/${p.id}`} className="flex items-center gap-3 py-3">
            <span className="serif flex size-10 items-center justify-center bg-bone text-[20px]">{p.name[0]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium">{p.name} <span className="mono ml-2 text-graphite">{roleLabel[p.role]}</span></p>
              <p className="mono truncate normal-case text-graphite">
                {p.email ?? "No email yet"}
                {p.hasPassword ? "" : p.pendingInvite ? " · Invite sent" : " · Needs an invite"}
                {p.devPasswordActive ? " · DEV password active" : ""}
              </p>
            </div>
            <span className="mono text-graphite">→</span>
          </Link>
        ))}
      </Card>
    </div>
  );
}

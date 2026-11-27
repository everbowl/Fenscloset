import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/auth/current";
import { listPeople } from "@/lib/people/service";
import { listOpenInvites } from "@/lib/auth/invite";
import { smsConfigured } from "@/lib/sms";
import { InviteSheet } from "./invite-sheet";
import { OpenInvites } from "./open-invites";

export const metadata = { title: "People" };

const roleLabel = { admin: "Admin", member: "Member", minor: "Minor" } as const;

export default async function PeoplePage() {
  await requireAdmin(); // before any data loads (review A S3)
  const [people, invites] = await Promise.all([listPeople(), listOpenInvites()]);
  const admins = people.filter((p) => p.role === "admin").map((p) => ({ id: p.id, name: p.name }));
  // Invites for people who already have a row show on that row ("Invite sent"); the rest would be invisible without this list (review A W6).
  const waiting = invites.filter((i) => !i.personId);
  return (
    <div className="lg:max-w-[640px]">
      <PageHeader title="People" action={<InviteSheet admins={admins} smsReady={smsConfigured()} />} />
      <ul className="flex flex-col gap-2" data-testid="people-list">
        {people.map((p) => (
          <li key={p.id}>
            <Link href={`/admin/people/${p.id}`} className="card tap flex items-center gap-3 p-3">
              <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-bone text-[17px] font-semibold">{p.name[0]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-medium leading-tight">{p.name}</span>
                <span className="caption block truncate">
                  {p.email ?? "No email yet"}
                  {p.hasPassword ? "" : p.pendingInvite ? " · Invite sent" : " · Needs an invite"}
                  {p.devPasswordActive ? " · DEV password active" : ""}
                </span>
              </span>
              <span className="pill pill-sm pointer-events-none shrink-0">{roleLabel[p.role]}</span>
            </Link>
          </li>
        ))}
      </ul>
      <OpenInvites invites={waiting.map((i) => ({ id: i.id, name: i.name, email: i.email, phone: i.phone, role: roleLabel[i.role], expiresAt: i.expiresAt.toISOString() }))} smsReady={smsConfigured()} />
    </div>
  );
}

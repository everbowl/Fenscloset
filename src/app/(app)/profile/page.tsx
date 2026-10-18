import Link from "next/link";
import { requirePerson, isAdmin } from "@/lib/auth/current";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/login/actions";

export const metadata = { title: "Profile" };

const roleLabel = { admin: "Admin", member: "Member", minor: "Minor" } as const;

function Row({ href, label, meta }: { href: string; label: string; meta?: string }) {
  return (
    <Link href={href} className="flex h-12 items-center justify-between border-b border-line text-[15px]">
      <span>{label}</span>
      <span className="mono text-graphite">{meta ?? "→"}</span>
    </Link>
  );
}

export default async function ProfilePage() {
  const person = await requirePerson();
  return (
    <div>
      <PageHeader title={person.name.split(" ")[0]} aside={roleLabel[person.role]} />
      <p className="mono normal-case text-graphite -mt-2 mb-4">{person.email ?? "No email yet"}</p>
      <section>
        <p className="mono border-b border-ink pb-2 text-graphite">You</p>
        <Row href="/profile/body" label="Body profile" meta="Phase 2" />
        <Row href="/profile/style" label="Style profile" meta="Phase 2" />
        <Row href="/profile/brands" label="Favorite brands & stores" meta="Phase 2" />
        <Row href="/change-password" label="Change password" />
      </section>
      {isAdmin(person) ? (
        <section className="mt-7">
          <p className="mono border-b border-ink pb-2 text-graphite">Admin</p>
          <Row href="/admin/people" label="People" />
          <Row href="/admin/lists" label="Lists" />
          <Row href="/admin/rules" label="Rules" />
        </section>
      ) : null}
      <form action={logoutAction} className="mt-8">
        <Button type="submit" variant="secondary" className="w-full">Log out</Button>
      </form>
    </div>
  );
}

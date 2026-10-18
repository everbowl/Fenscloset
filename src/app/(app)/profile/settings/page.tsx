import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requirePerson } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getPrivacy } from "@/lib/profiles/service";
import { SettingsEditor } from "./settings-editor";

export const metadata = { title: "Settings & privacy" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const me = await requirePerson();
  const [privacy, people] = await Promise.all([
    getPrivacy(me.id),
    db.person.findMany({ where: { status: { not: "removed" }, NOT: { id: me.id } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div>
      <Link href="/profile" className="mono mb-3 inline-block text-graphite">← Profile</Link>
      <PageHeader title="Settings" accent="& privacy" />
      <SettingsEditor privacy={privacy} people={people.map((p) => ({ id: p.id, name: p.name.split(" ")[0] }))} />
    </div>
  );
}

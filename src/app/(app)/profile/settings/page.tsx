import { PageHeader } from "@/components/ui/page-header";
import { requirePerson } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getPrivacy } from "@/lib/profiles/service";
import { SettingsEditor } from "./settings-editor";
import { getConnection, isGoogleConfigured, listCalendars } from "@/lib/plans/google";

export const metadata = { title: "Settings & privacy" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ calendar?: string }> }) {
  const me = await requirePerson();
  const { calendar } = await searchParams;
  const calendars = await listCalendars(me.id).catch(() => []);
  const [privacy, connection, people] = await Promise.all([
    getPrivacy(me.id),
    getConnection(me.id),
    db.person.findMany({ where: { status: { not: "removed" }, NOT: { id: me.id } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="lg:max-w-[640px]">
      <PageHeader title="Settings" accent="& privacy" />
      <SettingsEditor privacy={privacy} people={people.map((p) => ({ id: p.id, name: p.name.split(" ")[0] }))}
        calendar={{ configured: isGoogleConfigured(), email: connection?.email ?? null, connected: Boolean(connection), notice: calendar ?? null, calendars, calendarIds: connection?.calendarIds ?? [] }} />
    </div>
  );
}

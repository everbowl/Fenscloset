import { PageHeader } from "@/components/ui/page-header";
import { requirePerson } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getPrivacy } from "@/lib/profiles/service";
import { SettingsEditor } from "./settings-editor";
import { getConnection, isGoogleConfigured } from "@/lib/plans/google";
import * as plans from "@/lib/plans";

export const metadata = { title: "Settings & privacy" };
export const dynamic = "force-dynamic";

/** Whether the calendar connection has gone stale (Google refused the saved token). Read from the plans module when it offers it; never a reason to fail the page. */
async function calendarNeedsReconnect(personId: string): Promise<boolean> {
  const fn = (plans as { calendarNeedsReconnect?: (id: string) => Promise<boolean> }).calendarNeedsReconnect;
  if (typeof fn !== "function") return false;
  try { return await fn(personId); } catch { return false; }
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ calendar?: string }> }) {
  const me = await requirePerson();
  // Nothing here waits on Google (review E G1): the calendar names load when the Calendars row is tapped.
  const [{ calendar }, privacy, connection, people, needsReconnect] = await Promise.all([
    searchParams,
    getPrivacy(me.id),
    getConnection(me.id),
    db.person.findMany({ where: { status: { not: "removed" }, NOT: { id: me.id } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    calendarNeedsReconnect(me.id),
  ]);
  return (
    <div className="lg:max-w-[640px]">
      <PageHeader title="Settings" accent="& privacy" />
      <SettingsEditor privacy={privacy} people={people.map((p) => ({ id: p.id, name: p.name.split(" ")[0] }))}
        calendar={{ configured: isGoogleConfigured(), email: connection?.email ?? null, connected: Boolean(connection), needsReconnect, notice: calendar ?? null, calendarIds: connection?.calendarIds ?? [] }} />
    </div>
  );
}

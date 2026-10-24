import { requirePerson, isAdmin } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getTimezone } from "@/lib/rules";
import { dayKey } from "@/lib/dates";
import { listEntries } from "@/lib/lists/service";
import { latestTogether, togetherPeople } from "@/lib/outfits/together";
import { TogetherScreen } from "./together-screen";

export const metadata = { title: "Together" };
export const dynamic = "force-dynamic";

/** Screen 6 (undrawn): pick people, pick a mode, pick the plan, get one look per person. */
export default async function TogetherPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const me = await requirePerson();
  const { s } = await searchParams;
  const date = dayKey(new Date(), await getTimezone());
  const [people, occasions, latest] = await Promise.all([togetherPeople(me), listEntries("occasion"), latestTogether(me, date)]);
  const session = s ? (await import("@/lib/outfits/together")).getTogether(me, s) : null;
  const shown = (await session) ?? latest;
  const minors = (await db.guardianLink.findMany({ where: { parentId: me.id }, select: { minorId: true } })).map((g) => g.minorId);
  return (
    <TogetherScreen
      meId={me.id}
      people={people}
      canDressIds={[me.id, ...minors]}
      occasions={occasions.map((o) => ({ id: o.id, name: o.name }))}
      isAdmin={isAdmin(me)}
      session={shown && shown.date === date ? shown : null}
    />
  );
}

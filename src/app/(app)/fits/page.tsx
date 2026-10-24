import { cookies } from "next/headers";
import { requirePerson } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { resolveView, VIEW_COOKIE } from "@/lib/people/visibility";
import { dayKey, isValidDayKey } from "@/lib/dates";
import { getTimezone } from "@/lib/rules";
import { getDay, listMonth } from "@/lib/fits/service";
import { canDress } from "@/lib/outfits/engine";
import { listClosetItems } from "@/lib/items/query";
import { FitsScreen } from "./fits-screen";

export const metadata = { title: "Fits" };
export const dynamic = "force-dynamic";

/** Screen 05: month grid of worn looks, selected-day panel with the photo of the night, pieces, visibility and actions. */
export default async function FitsPage({ searchParams }: { searchParams: Promise<{ m?: string; d?: string }> }) {
  const me = await requirePerson();
  const { m, d } = await searchParams;
  const view = await resolveView(me, (await cookies()).get(VIEW_COOKIE)?.value);
  const today = dayKey(new Date(), await getTimezone());
  const selected = d && isValidDayKey(d) ? d : today;
  const [y, mo] = (m && /^\d{4}-\d{2}$/.test(m) ? m : selected.slice(0, 7)).split("-").map(Number);
  const personId = view.kind === "person" ? view.personId : me.id;
  const [days, fits, dress, people] = await Promise.all([
    listMonth(me, view, y, mo - 1), getDay(me, view, selected), canDress(me, personId),
    db.person.findMany({ where: { status: { not: "removed" } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);
  const closet = dress && selected <= today ? await listClosetItems({ kind: "person", personId, name: "" }) : [];
  const owner = view.kind === "person" ? await db.person.findUniqueOrThrow({ where: { id: view.personId }, select: { name: true } }) : null;
  return (
    <FitsScreen
      year={y} month0={mo - 1} today={today} selected={selected}
      days={days} fits={fits}
      scope={view.kind === "family" ? "family" : "person"}
      personId={personId} personName={owner ? owner.name.split(" ")[0] : me.name.split(" ")[0]}
      canDress={dress}
      people={people.filter((p) => p.id !== personId).map((p) => ({ id: p.id, name: p.name.split(" ")[0] }))}
      closet={closet.map((c) => ({ id: c.id, name: c.name, thumbKey: c.thumbKey, categoryName: c.categoryName }))}
    />
  );
}

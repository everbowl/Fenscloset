import Link from "next/link";
import { cookies } from "next/headers";
import { requirePerson, isAdmin } from "@/lib/auth/current";
import { resolveView, VIEW_COOKIE, canEditItem } from "@/lib/people/visibility";
import { listCleanOut } from "@/lib/outfits/cleanout";
import { PageHeader } from "@/components/ui/page-header";
import { CleanOutList } from "./clean-out-list";

export const metadata = { title: "Clean-out" };
export const dynamic = "force-dynamic";

/** Pieces not worn for the household's `notWornMonths`. Keep (snooze), donate or sell (retire). */
export default async function CleanOutPage() {
  const me = await requirePerson();
  const view = await resolveView(me, (await cookies()).get(VIEW_COOKIE)?.value);
  const personId = view.kind === "person" ? view.personId : me.id;
  const { months, items } = await listCleanOut(personId);
  const name = view.kind === "person" && view.personId !== me.id ? view.name : null;
  return (
    <div>
      <Link href="/closet" className="mono mb-3 inline-block text-graphite">← Closet</Link>
      <PageHeader
        eyebrow={<div className="flex items-center justify-between"><span>{items.length} {items.length === 1 ? "piece" : "pieces"} not worn in {months} months{name ? ` · ${name}` : ""}</span>{isAdmin(me) ? <Link href="/admin/rules" className="mono text-ink">Edit</Link> : null}</div>}
        title="Clean" accent="out" />
      <CleanOutList items={items.map((i) => ({ ...i, lastWornAt: i.lastWornAt?.toISOString() ?? null, createdAt: i.createdAt.toISOString() }))} canDecide={canEditItem(me, personId)} />
    </div>
  );
}

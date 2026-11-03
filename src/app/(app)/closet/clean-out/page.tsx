import Link from "next/link";
import { cookies } from "next/headers";
import { requirePerson, isAdmin } from "@/lib/auth/current";
import { resolveView, VIEW_COOKIE, canEditItem } from "@/lib/people/visibility";
import { listCleanOut, listStacks } from "@/lib/outfits/cleanout";
import { PageHeader } from "@/components/ui/page-header";
import { CleanOutList } from "./clean-out-list";

export const metadata = { title: "Clean-out" };
export const dynamic = "force-dynamic";

/** Pieces not worn for the household's `notWornMonths`. Keep (snooze), donate or sell (retire). */
export default async function CleanOutPage() {
  const me = await requirePerson();
  const view = await resolveView(me, (await cookies()).get(VIEW_COOKIE)?.value);
  const personId = view.kind === "person" ? view.personId : me.id;
  const [{ months, items }, stacks] = await Promise.all([listCleanOut(personId), listStacks(personId)]);
  const name = view.kind === "person" && view.personId !== me.id ? view.name : null;
  return (
    <div>
      <PageHeader
        eyebrow={<div className="flex items-center justify-between"><span>{items.length} {items.length === 1 ? "piece" : "pieces"} not worn in {months} months{stacks.length ? ` · ${stacks.length} ${stacks.length === 1 ? "stack" : "stacks"} to trim` : ""}{name ? ` · ${name}` : ""}</span>{isAdmin(me) ? <Link href="/admin/rules" className="pill pill-sm">Edit</Link> : null}</div>}
        title="Clean" accent="out" />
      <CleanOutList items={items.map((i) => ({ ...i, lastWornAt: i.lastWornAt?.toISOString() ?? null, createdAt: i.createdAt.toISOString() }))} stacks={stacks} canDecide={canEditItem(me, personId)} />
    </div>
  );
}

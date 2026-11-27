import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/auth/current";
import { LIST_DEFS, LIST_KINDS, type ListKind } from "@/lib/lists/registry";
import { countAll } from "@/lib/lists/service";
import { listOpenRequests } from "@/lib/lists/requests";
import { ListRequests } from "./list-requests";

export const metadata = { title: "Lists" };

/** The lists, grouped by what they describe, so twenty rows read as four short ones. */
const GROUPS: { title: string; kinds: ListKind[] }[] = [
  { title: "Clothes", kinds: ["category", "subcategory", "color", "pattern", "fabric", "season", "formality", "occasion", "tag"] },
  { title: "Sizes & bodies", kinds: ["size", "measurementKind", "brand", "store"] },
  { title: "Check-in & style", kinds: ["checkInScale", "checkInOption", "styleWord"] },
  { title: "Mirror", kinds: ["mirrorPose", "wearGroup", "wearOption"] },
  { title: "Household", kinds: ["closet", "shopSection"] },
];

export default async function ListsOverviewPage() {
  await requireAdmin(); // before any data loads (review A S3)
  const [counts, requests] = await Promise.all([countAll(), listOpenRequests()]);
  const placed = new Set(GROUPS.flatMap((g) => g.kinds));
  const rest = LIST_KINDS.filter((k) => !placed.has(k));
  const groups = rest.length ? [...GROUPS, { title: "Other", kinds: rest }] : GROUPS;
  return (
    <div className="lg:max-w-[640px]">
      <PageHeader title="Lists" aside={`${LIST_KINDS.length} lists`} />
      <p className="note mb-5">Every word the app uses. Edit, add, reorder, archive or delete any of it; the change shows everywhere at once.</p>
      <ListRequests requests={requests} />
      {groups.map((g) => (
        <section key={g.title} className="mb-6" data-testid={`lists-${g.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
          <h2 className="section mb-2">{g.title}</h2>
          <div className="card divide-y divide-line">
            {g.kinds.map((kind) => {
              const def = LIST_DEFS[kind];
              return (
                <Link key={kind} href={`/admin/lists/${kind}`} className="tap flex items-center gap-3 px-4 py-3 first:rounded-t-[16px] last:rounded-b-[16px]">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-medium leading-tight">{def.label}</span>
                    <span className="caption line-clamp-2 block">{def.description}</span>
                  </span>
                  <span className="caption shrink-0">{counts[kind]}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="shrink-0 text-graphite"><path d="m9 6 6 6-6 6" /></svg>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

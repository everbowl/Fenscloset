import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
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
  { title: "Household", kinds: ["closet"] },
];

export default async function ListsOverviewPage() {
  const [counts, requests] = await Promise.all([countAll(), listOpenRequests()]);
  const placed = new Set(GROUPS.flatMap((g) => g.kinds));
  const rest = LIST_KINDS.filter((k) => !placed.has(k));
  const groups = rest.length ? [...GROUPS, { title: "Other", kinds: rest }] : GROUPS;
  return (
    <div className="lg:max-w-[640px]">
      <PageHeader title="Lists" aside={`${LIST_KINDS.length} lists`} />
      <p className="mb-5 text-[14px] leading-snug text-graphite">Every word the app uses. Edit, add, reorder, archive or delete any of it; the change shows everywhere at once.</p>
      <ListRequests requests={requests} />
      {groups.map((g) => (
        <section key={g.title} className="mb-7" data-testid={`lists-${g.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
          <h2 className="mono border-b border-ink pb-2 text-graphite">{g.title}</h2>
          {g.kinds.map((kind) => {
            const def = LIST_DEFS[kind];
            return (
              <Link key={kind} href={`/admin/lists/${kind}`} className="tap flex items-center gap-3 border-b border-line py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">{def.label}</p>
                  <p className="line-clamp-2 text-[13px] leading-snug text-graphite">{def.description}</p>
                </div>
                <span className="mono mono-11 shrink-0 text-graphite">{counts[kind]}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="shrink-0 text-graphite"><path d="m9 6 6 6-6 6" /></svg>
              </Link>
            );
          })}
        </section>
      ))}
    </div>
  );
}

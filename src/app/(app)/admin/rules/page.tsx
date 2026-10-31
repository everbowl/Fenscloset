import { PageHeader } from "@/components/ui/page-header";
import { getRules } from "@/lib/rules";
import { RULE_GROUPS } from "@/lib/rules-kind";
import { RuleForm } from "./rule-form";
import { RefitPhotos } from "./refit-photos";
import { UntidyPhotos } from "./untidy-photos";
import { untidyPending } from "@/lib/items/untidy";
import type { RuleRow } from "@/lib/rules";

export const metadata = { title: "Rules" };

type Group = { title: string; blurb?: string; compact?: boolean; advanced?: boolean; rules: RuleRow[] };

function GroupSection({ g }: { g: Group }) {
  return (
    <section className="mb-8" data-testid={`rules-${g.title.toLowerCase().replace(/\s+/g, "-")}`}>
      <h2 className="mono border-b border-ink pb-2 text-graphite">{g.title}</h2>
      {g.blurb ? <p className="mt-2 text-[13px] leading-snug text-graphite">{g.blurb}</p> : null}
      <div className={g.compact ? "mt-1 flex flex-col" : "mt-4 flex flex-col gap-6"}>
        {g.rules.map((r) => <RuleForm key={r.key} rule={r} compact={Boolean(g.compact)} />)}
      </div>
    </section>
  );
}

/** Rules, grouped the way a parent thinks about them, each saving on its own the moment it changes. The technical ones fold under Advanced (R1). */
export default async function RulesPage() {
  const [rules, pending] = await Promise.all([getRules(), untidyPending()]);
  const byKey = new Map(rules.map((r) => [r.key, r]));
  const placed = new Set(RULE_GROUPS.flatMap((g) => g.keys));
  const other = rules.filter((r) => !placed.has(r.key));
  const groups: Group[] = [...RULE_GROUPS.map((g) => ({ ...g, rules: g.keys.map((k) => byKey.get(k)).filter(Boolean) as RuleRow[] })), ...(other.length ? [{ title: "Other", rules: other }] : [])].filter((g) => g.rules.length);
  const plain = groups.filter((g) => !g.advanced);
  const advanced = groups.filter((g) => g.advanced);
  return (
    <div className="lg:max-w-[640px]">
      <PageHeader title="Rules" />
      <p className="-mt-2 mb-6 text-[14px] leading-snug text-graphite">What the looks, the clean-out nudges, the Shop and the buttons follow. Each one saves on its own as you change it.</p>
      {plain.map((g) => <GroupSection key={g.title} g={g} />)}
      <section className="mb-8">
        <h2 className="mono border-b border-ink pb-2 text-graphite">Photo upkeep{pending ? ` · ${pending} ${pending === 1 ? "piece" : "pieces"} waiting` : ""}</h2>
        <UntidyPhotos pending={pending} />
        <RefitPhotos />
      </section>
      {advanced.length ? (
        <details className="group mb-8" data-testid="rules-advanced">
          <summary className="tap flex min-h-12 cursor-pointer list-none items-center justify-between border-y border-ink py-2 [&::-webkit-details-marker]:hidden">
            <span className="flex flex-col gap-0.5"><span className="mono text-[13px] uppercase tracking-[0.18em]">Advanced</span><span className="text-[14px] text-graphite">{advanced.map((g) => g.title).join(" · ")} · rarely needed</span></span>
            <span className="mono shrink-0 text-graphite group-open:hidden">Show</span><span className="mono hidden shrink-0 text-graphite group-open:inline">Hide</span>
          </summary>
          <div className="pt-6">{advanced.map((g) => <GroupSection key={g.title} g={g} />)}</div>
        </details>
      ) : null}
    </div>
  );
}

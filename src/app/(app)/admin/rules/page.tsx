import { PageHeader } from "@/components/ui/page-header";
import { getRules } from "@/lib/rules";
import { RULE_GROUPS } from "@/lib/rules-kind";
import { RuleForm } from "./rule-form";
import { RefitPhotos } from "./refit-photos";
import { UntidyPhotos } from "./untidy-photos";
import { untidyPending } from "@/lib/items/untidy";

export const metadata = { title: "Rules" };

/** Rules, grouped the way a parent thinks about them, each saving on its own the moment it changes. */
export default async function RulesPage() {
  const [rules, pending] = await Promise.all([getRules(), untidyPending()]);
  const byKey = new Map(rules.map((r) => [r.key, r]));
  const placed = new Set(RULE_GROUPS.flatMap((g) => g.keys));
  const other = rules.filter((r) => !placed.has(r.key));
  const groups = [...RULE_GROUPS.map((g) => ({ ...g, rules: g.keys.map((k) => byKey.get(k)).filter(Boolean) as typeof rules })), ...(other.length ? [{ title: "Other", keys: [], rules: other }] : [])].filter((g) => g.rules.length);
  return (
    <div className="lg:max-w-[640px]">
      <PageHeader title="Rules" />
      <p className="-mt-2 mb-6 text-[14px] leading-snug text-graphite">What the looks, the clean-out nudges, the Shop and the buttons follow. Each one saves on its own as you change it.</p>
      {groups.map((g) => (
        <section key={g.title} className="mb-8" data-testid={`rules-${g.title.toLowerCase().replace(/\s+/g, "-")}`}>
          <h2 className="mono border-b border-ink pb-2 text-graphite">{g.title}</h2>
          {"blurb" in g && g.blurb ? <p className="mt-2 text-[13px] leading-snug text-graphite">{g.blurb}</p> : null}
          <div className={"compact" in g && g.compact ? "mt-1 flex flex-col" : "mt-4 flex flex-col gap-6"}>
            {g.rules.map((r) => <RuleForm key={r.key} rule={r} compact={"compact" in g && Boolean(g.compact)} />)}
          </div>
        </section>
      ))}
      <section className="mb-8">
        <h2 className="mono border-b border-ink pb-2 text-graphite">Photo upkeep{pending ? ` · ${pending} ${pending === 1 ? "piece" : "pieces"} waiting` : ""}</h2>
        <UntidyPhotos pending={pending} />
        <RefitPhotos />
      </section>
    </div>
  );
}

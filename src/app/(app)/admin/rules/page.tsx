import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { getRules } from "@/lib/rules";
import { RuleForm } from "./rule-form";
import { RefitPhotos } from "./refit-photos";

export const metadata = { title: "Rules" };

export default async function RulesPage() {
  const rules = await getRules();
  return (
    <div>
      <PageHeader title="Rules" />
      <p className="-mt-2 mb-5 text-[14px] leading-snug text-graphite">What the outfit engine, the clean-out alerts, the buttons and the photo tools follow.</p>
      <Card className="space-y-7 border-x-0 border-b-0 border-t border-ink px-0 pt-5">
        {rules.map((r) => <RuleForm key={r.key} rule={r} />)}
      </Card>
      <div className="mt-10"><PageHeader title="Photo" accent="upkeep" /></div>
      <RefitPhotos />
    </div>
  );
}

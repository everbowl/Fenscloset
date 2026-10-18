import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { getRules } from "@/lib/rules";
import { RuleForm } from "./rule-form";

export const metadata = { title: "Rules" };

export default async function RulesPage() {
  const rules = await getRules();
  return (
    <div>
      <PageHeader title="Rules" subtitle="Numbers the outfit engine and clean-out alerts follow." />
      <Card className="space-y-6">
        {rules.map((r) => <RuleForm key={r.key} rule={r} />)}
      </Card>
    </div>
  );
}

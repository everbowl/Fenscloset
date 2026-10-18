"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveRuleAction, type RuleState } from "./actions";
import type { RuleRow } from "@/lib/rules";

export function RuleForm({ rule }: { rule: RuleRow }) {
  const [state, action, pending] = useActionState<RuleState, FormData>(saveRuleAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="key" value={rule.key} />
      <label htmlFor={`rule-${rule.key}`} className="block text-[15px] font-medium">{rule.label}</label>
      <p className="text-[13px] leading-snug text-graphite">{rule.description}</p>
      <div className="flex gap-2">
        {rule.key === "timezone"
          ? <Input id={`rule-${rule.key}`} name="value" type="text" defaultValue={rule.value} className="max-w-64" />
          : <Input id={`rule-${rule.key}`} name="value" type="number" inputMode="numeric" min={0} max={3650} defaultValue={rule.value} className="max-w-24" />}
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : state.saved === rule.key ? "Saved" : "Save"}</Button>
      </div>
      {state.error ? <p className="mono text-ink" role="alert">— {state.error}</p> : null}
    </form>
  );
}

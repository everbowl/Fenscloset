"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
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
      <p className="text-sm text-muted">{rule.description}</p>
      <div className="flex gap-2">
        <Input id={`rule-${rule.key}`} name="value" type="number" inputMode="numeric" min={0} max={3650} defaultValue={rule.value} className="max-w-32" />
        <Button type="submit" variant="secondary" disabled={pending}><Check className="size-4" /> {pending ? "Saving…" : state.saved === rule.key ? "Saved" : "Save"}</Button>
      </div>
      {state.error ? <p className="text-sm text-danger" role="alert">{state.error}</p> : null}
    </form>
  );
}

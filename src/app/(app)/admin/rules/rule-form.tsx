"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveRuleAction, type RuleState } from "./actions";
import { RULE_CHOICES, ruleKind } from "@/lib/rules-kind";
import type { RuleRow } from "@/lib/rules";

/** One rule: the input fits the value (a choice, on/off, a color, text, a number) and saves in place. */
export function RuleForm({ rule }: { rule: RuleRow }) {
  const [state, action, pending] = useActionState<RuleState, FormData>(saveRuleAction, {});
  const kind = ruleKind(rule);
  const id = `rule-${rule.key}`;
  const select = "h-[46px] border border-ink bg-paper px-3 font-mono text-[12px] uppercase tracking-[0.14em] text-ink";
  return (
    <form action={action} className="space-y-2" data-testid={`rule-${rule.key}`}>
      <input type="hidden" name="key" value={rule.key} />
      <label htmlFor={id} className="block text-[15px] font-medium">{rule.label}</label>
      <p className="text-[13px] leading-snug text-graphite">{rule.description}</p>
      <div className="flex gap-2">
        {kind === "choice" ? (
          <select id={id} name="value" defaultValue={rule.value} className={`${select} max-w-[70%]`}>
            {RULE_CHOICES[rule.key].map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        ) : kind === "onoff" ? (
          <select id={id} name="value" defaultValue={rule.value} className={select}>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        ) : kind === "color" ? (
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-[46px] shrink-0 border border-ink" style={{ background: rule.value }} />
            <Input id={id} name="value" type="text" defaultValue={rule.value} pattern="#[0-9A-Fa-f]{6}" className="max-w-36 font-mono uppercase" />
          </div>
        ) : kind === "text" ? (
          <Input id={id} name="value" type="text" defaultValue={rule.value} className="max-w-64" />
        ) : (
          <Input id={id} name="value" type="number" inputMode="numeric" min={0} max={3650} defaultValue={rule.value} className="max-w-24" />
        )}
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : state.saved === rule.key ? "Saved" : "Save"}</Button>
      </div>
      {state.error ? <p className="mono text-ink" role="alert">— {state.error}</p> : null}
    </form>
  );
}

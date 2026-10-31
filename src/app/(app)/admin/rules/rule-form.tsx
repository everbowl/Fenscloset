"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/input";
import { setRuleAction } from "./actions";
import { ACCENT_PRESETS, RULE_CHOICES, RULE_COPY, TIMEZONE_CHOICES, ruleKind } from "@/lib/rules-kind";
import type { RuleRow } from "@/lib/rules";
import { cn } from "@/lib/cn";

/**
 * One rule, saved the moment it changes: a choice or a color at once, a number or a line when it is left (or Enter).
 * "✓ Saved" fades in beside the label; an error stays until the next try. No Save buttons (there were fourteen).
 */
export function RuleForm({ rule, compact }: { rule: RuleRow; /** label left, input right: the Likely-sizes table */ compact?: boolean }) {
  const kind = ruleKind(rule);
  const copy = RULE_COPY[rule.key] ?? { label: rule.label, description: rule.description };
  const id = `rule-${rule.key}`;
  const [value, setValue] = useState(rule.value);
  const [saved, setSaved] = useState<string | null>(rule.value);
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const fade = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (fade.current) clearTimeout(fade.current); }, []);
  const [tzOther, setTzOther] = useState(!TIMEZONE_CHOICES.some((c) => c.value === rule.value));

  function save(v: string) {
    if (v === saved) return;
    setError(undefined);
    start(async () => {
      const r = await setRuleAction(rule.key, v);
      if (!r.ok) { setState("error"); setError(r.error); return; }
      setSaved(v); setState("saved");
      if (fade.current) clearTimeout(fade.current);
      fade.current = setTimeout(() => setState("idle"), 2000);
    });
  }
  const status = (
    <span className={cn("mono shrink-0 transition-opacity", state === "saved" ? "text-ink opacity-100" : "opacity-0")} aria-live="polite" data-testid={`rule-saved-${rule.key}`}>{pending ? "Saving…" : "✓ Saved"}</span>
  );
  const numberInput = (
    <Input id={id} type="number" inputMode="numeric" min={0} max={3650} value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => save(value.trim())}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(value.trim()); } }} className="max-w-24 text-right" aria-describedby={copy.description ? `${id}-help` : undefined} />
  );

  if (compact) {
    return (
      <div className="flex min-h-12 items-center gap-3 border-b border-line py-1.5" data-testid={`rule-${rule.key}`}>
        <label htmlFor={id} className="min-w-0 flex-1 text-[15px]">{copy.label}{copy.description ? <span className="mono ml-2 text-graphite">{copy.description}</span> : null}</label>
        <span className="flex items-center gap-2">{numberInput}<span className="mono w-10 text-graphite">{copy.unit ?? ""}</span></span>
        {status}
        {error ? <p className="mono text-ink" role="alert">— {error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={`rule-${rule.key}`}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="block text-[15px] font-medium">{copy.label}</label>
        {status}
      </div>
      {copy.description ? <p id={`${id}-help`} className="text-[13px] leading-snug text-graphite">{copy.description}</p> : null}
      {kind === "choice" ? (
        <Select id={id} value={value} onChange={(e) => { setValue(e.target.value); save(e.target.value); }} className="max-w-[360px]">
          {RULE_CHOICES[rule.key].map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      ) : kind === "onoff" ? (
        <div className="flex gap-1.5" role="radiogroup" aria-label={copy.label}>
          {(["on", "off"] as const).map((v) => <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => { setValue(v); save(v); }} className={cn("pill pill-sm", value === v && "pill-solid")}>{v === "on" ? "On" : "Off"}</button>)}
        </div>
      ) : kind === "color" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Preset colors">
            {ACCENT_PRESETS.map((p) => (
              <button key={p.value} type="button" role="radio" aria-checked={value.toUpperCase() === p.value} aria-label={p.label} title={p.label} onClick={() => { setValue(p.value); save(p.value); }}
                className={cn("size-9 rounded-full border-2", value.toUpperCase() === p.value ? "border-ink ring-2 ring-ink ring-offset-2" : "border-line")} style={{ background: p.value }} data-testid={`accent-${p.label.toLowerCase()}`} />
            ))}
            <label className="relative flex size-9 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-ink" title="Any color">
              <input id={id} type="color" value={/^#[0-9A-Fa-f]{6}$/.test(value) ? value : "#FF5A00"} onChange={(e) => setValue(e.target.value.toUpperCase())} onBlur={() => save(value)} className="absolute inset-0 size-full cursor-pointer opacity-0" aria-label="Pick any color" />
              <span className="mono text-[11px]" aria-hidden>+</span>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <span className="pill pill-solid pointer-events-none h-10 px-6" style={{ background: value, borderColor: value, color: "var(--black)", boxShadow: "0 5px 0 0 var(--color-stone)" }} aria-hidden>Wear this</span>
            <span className="mono text-graphite">{value.toUpperCase()}</span>
          </div>
        </div>
      ) : kind === "text" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Select id={id} value={tzOther ? "other" : value} onChange={(e) => { if (e.target.value === "other") { setTzOther(true); return; } setTzOther(false); setValue(e.target.value); save(e.target.value); }} className="max-w-[240px]">
            {TIMEZONE_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            <option value="other">Other…</option>
          </Select>
          {tzOther ? <Input aria-label="Time zone name" value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => save(value.trim())} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(value.trim()); } }} placeholder="Europe/Paris" className="max-w-[240px]" /> : null}
        </div>
      ) : (
        <div className="flex items-center gap-2">{numberInput}<span className="mono text-graphite">{copy.unit ?? ""}</span></div>
      )}
      {error ? <p className="mono text-ink" role="alert">— {error}</p> : null}
    </div>
  );
}

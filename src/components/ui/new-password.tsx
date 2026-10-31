"use client";

import { useState } from "react";
import { PasswordInput } from "./password-input";
import { Field } from "./field";
import { cn } from "@/lib/cn";

/** How strong a password is, in plain words (Jeff, 31 Oct 2026, S1): length first, variety second. */
export function passwordStrength(v: string): { ok: boolean; word: string } {
  if (!v) return { ok: false, word: "" };
  if (v.length < 8) return { ok: false, word: `Too short · ${8 - v.length} more` };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(v)).length;
  if (v.length >= 12 || kinds >= 3) return { ok: true, word: "Strong enough" };
  return { ok: true, word: "Okay · longer is stronger" };
}

/** One password field with Show and a strength line underneath. No "type it again": Show is the check. */
export function NewPasswordField({ id = "password", name = "password", label = "New password", error }: { id?: string; name?: string; label?: string; error?: string }) {
  const [v, setV] = useState("");
  const s = passwordStrength(v);
  return (
    <Field label={label} htmlFor={id} error={error}>
      <PasswordInput id={id} name={name} autoComplete="new-password" required minLength={8} value={v} onChange={(e) => setV(e.target.value)} aria-describedby={`${id}-strength`} aria-invalid={error ? true : undefined} />
      <p id={`${id}-strength`} className={cn("mono mt-1", s.ok ? "text-ink" : "text-graphite")} aria-live="polite" data-testid="password-strength">{s.word || "At least 8 characters · tap Show to check it"}</p>
    </Field>
  );
}

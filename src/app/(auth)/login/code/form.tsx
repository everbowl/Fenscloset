"use client";

import Link from "next/link";
import { useActionState } from "react";
import { redeemPhoneCodeAction, type CodeState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

export function CodeForm() {
  const [state, action, pending] = useActionState<CodeState, FormData>(redeemPhoneCodeAction, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <Field label="Six-digit code" htmlFor="code" error={state.error}>
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={7} required placeholder="000 000" className="text-[28px] tracking-[0.2em]" />
      </Field>
      <Button type="submit" size="lg" className="w-full" busy={pending} arrow={false}>{pending ? "Signing in…" : "Sign in"}</Button>
      <Link href="/login" className="pill pill-quiet h-12 w-full">Back to sign in</Link>
    </form>
  );
}

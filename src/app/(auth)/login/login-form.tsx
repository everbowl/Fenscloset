"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="flex flex-col gap-[18px]" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" required defaultValue={state.email ?? ""} />
      </Field>
      <Field label="Password" htmlFor="password" error={state.error}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" size="lg" className="mt-1 w-full tracking-[0.2em]" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
      <div className="mono mono-11 flex justify-between tracking-[0.1em]">
        <Link href="/forgot-password" className="py-2.5 underline underline-offset-4 decoration-1">Forgot password?</Link>
        <Link href="/invite" className="py-2.5 underline underline-offset-4 decoration-1">I have an invite</Link>
      </div>
    </form>
  );
}

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
    <form action={action} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" required placeholder="you@example.com" defaultValue={state.email ?? ""} />
      </Field>
      <Field label="Password" htmlFor="password" error={state.error}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="font-medium text-accent underline-offset-4 hover:underline">Forgot password?</Link>
      </p>
    </form>
  );
}

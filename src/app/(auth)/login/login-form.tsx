"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Field } from "@/components/ui/field";

export function LoginForm({ next, prefillEmail }: { next?: string; prefillEmail?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" required defaultValue={state.email ?? prefillEmail ?? ""} />
      </Field>
      <Field label="Password" htmlFor="password" error={state.error}>
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" size="lg" className="mt-1 w-full" busy={pending} arrow={false}>{pending ? "Signing in…" : "Sign in"}</Button>
      <div className="flex flex-wrap justify-between gap-2">
        <Link href="/forgot-password" className="pill pill-quiet">Forgot password?</Link>
        <Link href="/invite" className="pill pill-quiet">I have an invite</Link>
        <Link href="/login/code" className="pill pill-quiet">Have a code?</Link>
      </div>
    </form>
  );
}

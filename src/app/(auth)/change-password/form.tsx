"use client";

import { useActionState } from "react";
import { changePasswordAction, type ChangePasswordState } from "./actions";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Field } from "@/components/ui/field";

export function ChangePasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      {/* The account, for the password manager: it saves the new password against the right email. */}
      <input type="email" name="username" value={email} readOnly autoComplete="username" className="sr-only" tabIndex={-1} aria-hidden />
      <Field label="New password" htmlFor="password" hint="At least 8 characters.">
        <PasswordInput id="password" name="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Type it again" htmlFor="confirm" error={state.error}>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" required aria-invalid={state.error ? true : undefined} />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Saving…" : "Save new password"}</Button>
    </form>
  );
}

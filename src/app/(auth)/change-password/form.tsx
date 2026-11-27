"use client";

import { useActionState } from "react";
import { changePasswordAction, type ChangePasswordState } from "./actions";
import { Button } from "@/components/ui/button";
import { NewPasswordField } from "@/components/ui/new-password";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";

export function ChangePasswordForm({ email, askCurrent = false }: { email: string; /** The current password is asked for unless the person is in the forced-change state (security item 14). */ askCurrent?: boolean }) {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {/* The account, for the password manager: it saves the new password against the right email. */}
      <input type="email" name="username" value={email} readOnly autoComplete="username" className="sr-only" tabIndex={-1} aria-hidden />
      {askCurrent ? <Field label="Current password" htmlFor="current"><PasswordInput id="current" name="current" autoComplete="current-password" required data-testid="current-password" /></Field> : null}
      <NewPasswordField label="New password" error={state.error} />
      <Button type="submit" size="lg" className="w-full" busy={pending} arrow={false}>{pending ? "Saving…" : "Save new password"}</Button>
    </form>
  );
}

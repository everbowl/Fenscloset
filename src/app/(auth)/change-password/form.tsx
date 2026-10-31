"use client";

import { useActionState } from "react";
import { changePasswordAction, type ChangePasswordState } from "./actions";
import { Button } from "@/components/ui/button";
import { NewPasswordField } from "@/components/ui/new-password";

export function ChangePasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      {/* The account, for the password manager: it saves the new password against the right email. */}
      <input type="email" name="username" value={email} readOnly autoComplete="username" className="sr-only" tabIndex={-1} aria-hidden />
      <NewPasswordField label="New password" error={state.error} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Saving…" : "Save new password"}</Button>
    </form>
  );
}

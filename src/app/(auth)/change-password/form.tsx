"use client";

import { useActionState } from "react";
import { changePasswordAction, type ChangePasswordState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="New password" htmlFor="password" hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Type it again" htmlFor="confirm" error={state.error}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Saving…" : "Save new password"}</Button>
    </form>
  );
}

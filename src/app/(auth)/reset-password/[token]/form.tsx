"use client";

import { useActionState } from "react";
import { resetPasswordAction, type ResetState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

export function ResetForm({ token }: { token: string }) {
  const bound = resetPasswordAction.bind(null, token);
  const [state, action, pending] = useActionState<ResetState, FormData>(bound, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="New password" htmlFor="password" hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Type it again" htmlFor="confirm" error={state.error}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Saving…" : "Save and sign in"}</Button>
    </form>
  );
}

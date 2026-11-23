"use client";

import { useActionState } from "react";
import { resetPasswordAction, type ResetState } from "./actions";
import { Button } from "@/components/ui/button";
import { NewPasswordField } from "@/components/ui/new-password";

export function ResetForm({ token }: { token: string }) {
  const bound = resetPasswordAction.bind(null, token);
  const [state, action, pending] = useActionState<ResetState, FormData>(bound, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <NewPasswordField label="New password" error={state.error} />
      <Button type="submit" size="lg" className="w-full" busy={pending} arrow={false}>{pending ? "Saving…" : "Save and sign in"}</Button>
    </form>
  );
}

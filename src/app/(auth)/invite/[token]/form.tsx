"use client";

import { useActionState } from "react";
import { acceptInviteAction, type AcceptState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewPasswordField } from "@/components/ui/new-password";
import { Field } from "@/components/ui/field";

export function AcceptForm({ token, name, email }: { token: string; name: string; email: string | null }) {
  const bound = acceptInviteAction.bind(null, token);
  const [state, action, pending] = useActionState<AcceptState, FormData>(bound, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Your name" htmlFor="name"><Input id="name" name="name" defaultValue={name} autoComplete="name" required /></Field>
      {email ? (
        <Field label="Email" htmlFor="email" hint="You'll sign in with this."><Input id="email" name="username" value={email} readOnly autoComplete="username" /></Field>
      ) : (
        <Field label="Email" htmlFor="email" hint="You'll sign in with this."><Input id="email" name="email" type="email" inputMode="email" autoCapitalize="none" autoComplete="username" required /></Field>
      )}
      <NewPasswordField label="Choose a password" error={state.error} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Setting up…" : "Open my closet"}</Button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { acceptInviteAction, type AcceptState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
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
      <Field label="Choose a password" htmlFor="password" hint="At least 8 characters."><PasswordInput id="password" name="password" autoComplete="new-password" required minLength={8} /></Field>
      <Field label="Type it again" htmlFor="confirm" error={state.error}><PasswordInput id="confirm" name="confirm" autoComplete="new-password" required aria-invalid={state.error ? true : undefined} /></Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Setting up…" : "Open my closet"}</Button>
    </form>
  );
}

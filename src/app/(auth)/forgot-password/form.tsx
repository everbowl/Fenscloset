"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPasswordAction, type ForgotState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Banner } from "@/components/ui/banner";

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(forgotPasswordAction, {});
  if (state.done) {
    return (
      <div className="space-y-4">
        <Banner tone="success" title="Check your email">
          If {state.email} belongs to someone in the family, a reset link is on its way. It works once and expires in 60 minutes.
        </Banner>
        <Link href="/login" className="block text-center text-sm font-medium text-accent">Back to sign in</Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Email" htmlFor="email" error={state.error}>
        <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" required defaultValue={state.email ?? ""} />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</Button>
      <Link href="/login" className="block text-center text-sm font-medium text-accent">Back to sign in</Link>
    </form>
  );
}

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
      <div className="flex flex-col gap-5">
        <Banner tone="success" title="Check your email">
          If {state.email} belongs to someone in the family, a reset link is on its way. It works once and expires in 60 minutes.
        </Banner>
        <Link href="/login" className="mono mono-11 py-2.5 underline underline-offset-4">Back to sign in</Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-[18px]" noValidate>
      <Field label="Email" htmlFor="email" error={state.error}>
        <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" required defaultValue={state.email ?? ""} />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</Button>
      <Link href="/login" className="mono mono-11 py-2.5 underline underline-offset-4">Back to sign in</Link>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPasswordAction, type ForgotState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(forgotPasswordAction, {});
  if (state.done) {
    return (
      <div className="flex flex-col gap-5">
        <div className="card p-4" role="status">
          <p className="section">Check your email</p>
          <p className="note mt-1.5">If {state.email} belongs to someone in the family, a reset link is on its way. It works once and expires in 60 minutes.</p>
        </div>
        <Link href="/login" className="pill h-12 w-full">Back to sign in</Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <Field label="Email" htmlFor="email" error={state.error}>
        <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" required defaultValue={state.email ?? ""} />
      </Field>
      <Button type="submit" size="lg" className="w-full" busy={pending} arrow={false}>{pending ? "Sending…" : "Send reset link"}</Button>
      <Link href="/login" className="pill pill-quiet h-12 w-full">Back to sign in</Link>
    </form>
  );
}

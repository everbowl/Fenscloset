"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { createPhoneCodeAction } from "@/app/(auth)/login/code/actions";

type Shown = { code: string; expiresAt: number; loginUrl: string };

function left(expiresAt: number): string {
  const s = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * "Sign in on another phone" for Profile › Settings (admins): shows a six-digit code that signs this same person in on a
 * second phone from its sign-in page ("Have a code?"), for ten minutes, once. Mount it in the Account section of
 * src/app/(app)/profile/settings/settings-editor.tsx when `privacy.isAdmin`.
 */
export function PhoneSignInCode() {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [, tick] = useState(0);

  useEffect(() => {
    if (!shown) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [shown]);

  function make() {
    setError(undefined);
    start(async () => {
      const r = await createPhoneCodeAction();
      if (!r.ok) { setError(r.error); return; }
      setShown({ code: r.code, expiresAt: new Date(r.expiresAt).getTime(), loginUrl: r.loginUrl });
    });
  }
  const expired = shown ? shown.expiresAt <= Date.now() : false;

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); if (!shown || expired) make(); }} className="tap flex h-12 w-full items-center justify-between text-[15px]" data-testid="phone-code-open">
        Sign in on another phone<span className="caption">→</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Sign in on another phone">
        <div className="flex flex-col gap-4">
          <p className="note">On the other phone, open the sign-in page, tap <span className="font-medium text-ink">Have a code?</span>, and type this. It signs that phone in as you.</p>
          {error ? <p className="text-[15px] leading-snug" role="alert">— {error}</p> : null}
          {shown ? (
            <div className="stage flex flex-col items-center gap-2 p-5" aria-live="polite">
              <p className="text-[44px] font-semibold tracking-[0.25em]" data-testid="phone-code">{pending ? "· · · · · ·" : `${shown.code.slice(0, 3)} ${shown.code.slice(3)}`}</p>
              <p className="caption">{expired ? "Expired" : `Works once · ${left(shown.expiresAt)} left`}</p>
              {shown.loginUrl ? <p className="caption break-all text-center">{shown.loginUrl}</p> : null}
            </div>
          ) : pending ? <p className="caption text-center">Making a code…</p> : null}
          <Button variant="secondary" className="w-full" busy={pending} onClick={make}>{shown ? "New code" : "Make a code"}</Button>
          <button type="button" className="pill pill-quiet h-12 w-full" onClick={() => setOpen(false)}>Done</button>
        </div>
      </Sheet>
    </>
  );
}

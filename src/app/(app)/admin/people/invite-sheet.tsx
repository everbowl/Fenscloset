"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { InviteLink } from "./invite-link";
import { invitePersonAction, type InviteResult } from "./actions";
import type { Role } from "@/generated/prisma/client";

type Admin = { id: string; name: string };

/**
 * Invite flow used both for brand-new people ("+ Add person") and for re-inviting an existing
 * seeded person who hasn't set a password yet. Produces an email, a text, and always a copyable link.
 */
export function InviteSheet({ admins, smsReady, existing, trigger }: {
  admins: Admin[];
  smsReady: boolean;
  existing?: { id: string; name: string; email: string | null; phone: string | null; role: Role; guardianIds: string[] };
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(existing?.name ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [role, setRole] = useState<Role>(existing?.role ?? "member");
  const [guardianIds, setGuardianIds] = useState<string[]>(existing?.guardianIds ?? admins.map((a) => a.id));
  const [sendEmail, setSendEmail] = useState(true);
  const [sendSms, setSendSms] = useState(false);
  const [result, setResult] = useState<InviteResult>();
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const channels: Array<"email" | "sms"> = [];
      if (sendEmail && email) channels.push("email");
      if (sendSms && phone) channels.push("sms");
      const res = await invitePersonAction({ personId: existing?.id, name, email, phone, role, guardianIds: role === "minor" ? guardianIds : [], channels });
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <>
      <span onClick={() => { setResult(undefined); setOpen(true); }}>
        {trigger ?? <Button size="sm" variant="secondary"><Plus className="size-3.5" strokeWidth={1.8} /> Add person</Button>}
      </span>
      <Sheet open={open} onClose={() => setOpen(false)} title={existing ? `Invite ${existing.name}` : "Add a person"}>
        {result?.ok ? (
          <InviteLink result={result} name={name} email={email} phone={phone} onDone={() => setOpen(false)} />
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            {result && !result.ok ? <p className="text-[15px] leading-snug" role="alert">— {result.error}</p> : null}
            {/* No autoFocus: iPhones ignore focus that is not a tap and scroll the sheet oddly (review A I4). */}
            <Field label="Name" htmlFor="inv-name"><Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label="Email" htmlFor="inv-email" hint="They'll sign in with this."><Input id="inv-email" type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Mobile number" htmlFor="inv-phone" hint="For the text-message invite."><Input id="inv-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" /></Field>
            <Field label="Role" htmlFor="inv-role">
              <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="member">Member (adult)</option>
                <option value="admin">Admin (parent)</option>
                <option value="minor">Minor (under 18)</option>
              </Select>
            </Field>
            {role === "minor" ? (
              <fieldset className="flex flex-col gap-1">
                <legend className="mono text-graphite">Parent admins</legend>
                {admins.map((a) => (
                  <label key={a.id} className="flex h-11 items-center gap-3 text-[15px]">
                    <input type="checkbox" className="size-5 accent-black" checked={guardianIds.includes(a.id)}
                      onChange={(e) => setGuardianIds((g) => (e.target.checked ? [...g, a.id] : g.filter((x) => x !== a.id)))} />
                    {a.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <fieldset className="flex flex-col gap-1">
              <legend className="mono text-graphite">Send the invite by</legend>
              <label className="flex h-11 items-center gap-3 text-[15px]"><input type="checkbox" className="size-5 accent-black" checked={sendEmail && Boolean(email)} onChange={(e) => setSendEmail(e.target.checked)} disabled={!email} /> Email{email ? "" : <span className="caption">add an email above</span>}</label>
              <label className="flex h-11 items-center gap-3 text-[15px]"><input type="checkbox" className="size-5 accent-black" checked={sendSms} onChange={(e) => setSendSms(e.target.checked)} disabled={!phone || !smsReady} /> Text message{!smsReady ? <span className="caption">texting isn&apos;t set up yet</span> : phone ? "" : <span className="caption">add a number above</span>}</label>
              <p className="note">You&apos;ll always get a link to copy or share yourself.</p>
            </fieldset>
            <Button type="submit" className="w-full" busy={pending} disabled={!name}>{pending ? "Creating…" : "Create invite"}</Button>
          </form>
        )}
      </Sheet>
    </>
  );
}

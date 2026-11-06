"use client";

import { Check, Copy, Plus, Share2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Banner } from "@/components/ui/banner";
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
  const [copied, setCopied] = useState(false);
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

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  }
  async function share(url: string) {
    if (navigator.share) { try { await navigator.share({ title: "Fen's Closet invite", text: `${name}, set up your closet:`, url }); } catch { /* cancelled */ } }
    else copy(url);
  }

  return (
    <>
      <span onClick={() => { setResult(undefined); setOpen(true); }}>
        {trigger ?? <Button size="sm"><Plus className="size-3.5" strokeWidth={1.8} /> Add person</Button>}
      </span>
      <Sheet open={open} onClose={() => setOpen(false)} title={existing ? `Invite ${existing.name}` : "Add a person"}>
        {result?.ok ? (
          <div className="space-y-4">
            <Banner tone="success" title="Invite created">
              {result.delivered.email ? `Email sent to ${email}. ` : ""}{result.delivered.sms ? `Text sent to ${phone}. ` : ""}
              The link works for 7 days.
            </Banner>
            {result.deliveryError ? <Banner tone="danger">{result.deliveryError}</Banner> : null}
            <div data-testid="invite-url" className="break-all bg-bone p-3 font-mono text-[11px]">{result.url}</div>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => copy(result.url)}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy link"}</Button>
              <Button className="flex-1" onClick={() => share(result.url)}><Share2 className="size-4" /> Share…</Button>
            </div>
            <Button variant="ghost" className="w-full" onClick={() => setOpen(false)}>Done</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {result && !result.ok ? <Banner tone="danger">{result.error}</Banner> : null}
            <Field label="Name" htmlFor="inv-name"><Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus={!existing} /></Field>
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
              <fieldset className="space-y-2">
                <legend className="mono tracking-[0.14em] text-graphite">Parent admins</legend>
                {admins.map((a) => (
                  <label key={a.id} className="flex h-11 items-center gap-3 text-[15px]">
                    <input type="checkbox" className="size-5 accent-black" checked={guardianIds.includes(a.id)}
                      onChange={(e) => setGuardianIds((g) => (e.target.checked ? [...g, a.id] : g.filter((x) => x !== a.id)))} />
                    {a.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <fieldset className="space-y-2">
              <legend className="mono tracking-[0.14em] text-graphite">Send the invite by</legend>
              <label className="flex h-11 items-center gap-3 text-[15px]"><input type="checkbox" className="size-5 accent-black" checked={sendEmail && Boolean(email)} onChange={(e) => setSendEmail(e.target.checked)} disabled={!email} /> Email{email ? "" : <span className="mono ml-2 text-graphite">add an email above</span>}</label>
              <label className="flex h-11 items-center gap-3 text-[15px]"><input type="checkbox" className="size-5 accent-black" checked={sendSms} onChange={(e) => setSendSms(e.target.checked)} disabled={!phone || !smsReady} /> Text message{!smsReady ? <span className="mono ml-2 text-graphite">texting isn’t set up yet</span> : phone ? "" : <span className="mono ml-2 text-graphite">add a number above</span>}</label>
              <p className="text-[13px] leading-snug text-graphite">You&apos;ll always get a link to copy or share yourself.</p>
            </fieldset>
            <Button type="submit" className="w-full" disabled={pending || !name}>{pending ? "Creating…" : "Create invite"}</Button>
          </form>
        )}
      </Sheet>
    </>
  );
}

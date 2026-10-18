"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import type { PersonSummary } from "@/lib/people/service";
import type { Role } from "@/generated/prisma/client";
import { removePersonAction, setGuardiansAction, setRoleAction, updatePersonAction } from "../actions";
import { InviteSheet } from "../invite-sheet";

export function PersonEditor({ person, admins, smsReady, isSelf }: { person: PersonSummary; admins: { id: string; name: string }[]; smsReady: boolean; isSelf: boolean }) {
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email ?? "");
  const [phone, setPhone] = useState(person.phone ?? "");
  const [birthdate, setBirthdate] = useState(person.birthdate ? person.birthdate.toISOString().slice(0, 10) : "");
  const [role, setRole] = useState<Role>(person.role);
  const [guardianIds, setGuardianIds] = useState(person.guardianIds);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string }>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    start(async () => {
      const r = await fn();
      setNotice(r.ok ? { tone: "success", text: okText } : { tone: "danger", text: r.error ?? "Couldn't save." });
    });
  }

  return (
    <div className="space-y-5">
      {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}

      <Card className="space-y-4 border-x-0 border-b-0 border-t border-ink px-0 pt-4">
        <h2 className="mono text-graphite">Details</h2>
        <Field label="Name" htmlFor="p-name"><Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email" htmlFor="p-email" hint="Used to sign in."><Input id="p-email" type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Mobile number" htmlFor="p-phone"><Input id="p-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Birthday" htmlFor="p-bday"><Input id="p-bday" type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} /></Field>
        <Button variant="secondary" disabled={pending} onClick={() => run(() => updatePersonAction(person.id, { name, email: email || null, phone: phone || null, birthdate: birthdate || null }), "Details saved.")}>
          Save details
        </Button>
      </Card>

      <Card className="space-y-4 border-x-0 border-b-0 border-t border-ink px-0 pt-4">
        <h2 className="mono text-graphite">Role</h2>
        <Field label="Role" htmlFor="p-role">
          <Select id="p-role" value={role} disabled={isSelf} onChange={(e) => { const r = e.target.value as Role; setRole(r); run(() => setRoleAction(person.id, r), "Role updated."); }}>
            <option value="member">Member (adult)</option>
            <option value="admin">Admin (parent)</option>
            <option value="minor">Minor (under 18)</option>
          </Select>
          {isSelf ? <p className="mono mt-1 normal-case text-[11px] text-graphite">You can&apos;t change your own role.</p> : null}
        </Field>
        {role === "minor" ? (
          <fieldset className="space-y-2">
            <legend className="mono tracking-[0.14em] text-graphite">Parent admins</legend>
            {admins.map((a) => (
              <label key={a.id} className="flex h-10 items-center gap-3 text-[15px]">
                <input type="checkbox" className="size-5 accent-black" checked={guardianIds.includes(a.id)}
                  onChange={(e) => { const next = e.target.checked ? [...guardianIds, a.id] : guardianIds.filter((x) => x !== a.id); setGuardianIds(next); run(() => setGuardiansAction(person.id, next), "Parents updated."); }} />
                {a.name}
              </label>
            ))}
          </fieldset>
        ) : null}
      </Card>

      <Card className="space-y-3 border-x-0 border-b-0 border-t border-ink px-0 pt-4">
        <h2 className="mono text-graphite">Login</h2>
        <p className="text-[14px] leading-snug text-graphite">
          {person.hasPassword ? "Has a password and can sign in." : person.pendingInvite ? "An invite is out. Send another if it got lost." : "Hasn't set a password yet. Send an invite."}
          {person.devPasswordActive ? " The one-time DEV password is active." : ""}
        </p>
        <InviteSheet admins={admins} smsReady={smsReady} existing={{ id: person.id, name, email: email || null, phone: phone || null, role, guardianIds }}
          trigger={<Button variant="secondary">{person.hasPassword ? "Send a new invite link" : "Send invite"}</Button>} />
      </Card>

      {!isSelf ? (
        <Card className="space-y-3 border-x-0 border-b-0 border-t border-danger px-0 pt-4">
          <h2 className="mono text-danger">Remove {person.name}</h2>
          <p className="text-[14px] leading-snug text-graphite">They lose access right away. You choose what happens to their clothes.</p>
          <Button variant="danger" onClick={() => setConfirmRemove(true)}>Remove person</Button>
        </Card>
      ) : null}

      <Sheet open={confirmRemove} onClose={() => setConfirmRemove(false)} title={`Remove ${person.name}?`}>
        <p className="text-[14px] leading-snug text-graphite">What should happen to the clothes in {person.name}&apos;s closet?</p>
        <div className="mt-4 space-y-2">
          <Button variant="secondary" className="w-full" disabled={pending} onClick={() => run(() => removePersonAction(person.id, "moveToFamily"), "Moved.")}>Move them to the Family closet</Button>
          <Button variant="danger" className="w-full" disabled={pending} onClick={() => run(() => removePersonAction(person.id, "delete"), "Deleted.")}>Delete them</Button>
          <Button variant="ghost" className="w-full" onClick={() => setConfirmRemove(false)}>Cancel</Button>
        </div>
      </Sheet>
    </div>
  );
}

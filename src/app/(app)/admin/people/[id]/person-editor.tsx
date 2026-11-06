"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import type { PersonSummary } from "@/lib/people/service";
import type { Role } from "@/generated/prisma/client";
import { removePersonAction, setGuardiansAction, setRoleAction, updatePersonAction } from "../actions";
import { InviteSheet } from "../invite-sheet";
import { setMinorBodyImageApprovalAction } from "@/app/(app)/profile/actions";

export function PersonEditor({ person, admins, smsReady, isSelf, bodyPhotos }: { person: PersonSummary; admins: { id: string; name: string }[]; smsReady: boolean; isSelf: boolean; bodyPhotos: { allowed: boolean; approvedBy: string | null; isParent: boolean } | null }) {
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email ?? "");
  const [phone, setPhone] = useState(person.phone ?? "");
  const [birthdate, setBirthdate] = useState(person.birthdate ? person.birthdate.toISOString().slice(0, 10) : "");
  const [role, setRole] = useState<Role>(person.role);
  const [guardianIds, setGuardianIds] = useState(person.guardianIds);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmRole, setConfirmRole] = useState<Role | null>(null);
  const [pending, start] = useTransition();
  const first = name.split(" ")[0] || "them";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    start(async () => {
      const r = await fn();
      if (r.ok) toast.ok(okText); else toast.error(r.error ?? "Couldn’t save.");
    });
  }
  // Details save when a field is left, if it changed; no Save button to find.
  const savedDetails = { name: person.name, email: person.email ?? "", phone: person.phone ?? "", birthdate: person.birthdate ? person.birthdate.toISOString().slice(0, 10) : "" };
  const last = useState(savedDetails)[0];
  const dirty = useRef(false);
  function saveDetails() {
    const next = { name, email, phone, birthdate };
    if (!dirty.current || (next.name === last.name && next.email === last.email && next.phone === last.phone && next.birthdate === last.birthdate)) return;
    dirty.current = false;
    Object.assign(last, next);
    run(() => updatePersonAction(person.id, { name, email: email || null, phone: phone || null, birthdate: birthdate || null }), "Details saved");
  }
  const ROLE_WORD: Record<Role, string> = { member: "a member", admin: "an admin (a parent)", minor: "a minor" };
  function pickRole(r: Role) {
    if (r === role) return;
    // Giving or taking admin rights is the one change that asks first.
    if (r === "admin" || role === "admin") { setConfirmRole(r); return; }
    setRole(r); run(() => setRoleAction(person.id, r), "Role updated");
  }

  return (
    <div className="space-y-5">

      <Card className="space-y-4 border-x-0 border-b-0 border-t border-ink px-0 pt-4">
        <h2 className="mono text-graphite">Details</h2>
        <Field label="Name" htmlFor="p-name" hint="Saves when you leave the field."><Input id="p-name" value={name} onChange={(e) => { dirty.current = true; setName(e.target.value); }} onBlur={saveDetails} autoComplete="name" /></Field>
        <Field label="Email" htmlFor="p-email" hint="Used to sign in."><Input id="p-email" type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => { dirty.current = true; setEmail(e.target.value); }} onBlur={saveDetails} /></Field>
        <Field label="Mobile number" htmlFor="p-phone"><Input id="p-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => { dirty.current = true; setPhone(e.target.value); }} onBlur={saveDetails} /></Field>
        <Field label="Birthday" htmlFor="p-bday"><Input id="p-bday" type="date" value={birthdate} onChange={(e) => { dirty.current = true; setBirthdate(e.target.value); }} onBlur={saveDetails} /></Field>
      </Card>

      <Card className="space-y-4 border-x-0 border-b-0 border-t border-ink px-0 pt-4">
        <h2 className="mono text-graphite">Role</h2>
        <Field label="Role" htmlFor="p-role">
          <Select id="p-role" value={role} disabled={isSelf} onChange={(e) => pickRole(e.target.value as Role)}>
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
              <label key={a.id} className="flex h-11 items-center gap-3 text-[15px]">
                <input type="checkbox" className="size-5 accent-black" checked={guardianIds.includes(a.id)}
                  onChange={(e) => { const next = e.target.checked ? [...guardianIds, a.id] : guardianIds.filter((x) => x !== a.id); setGuardianIds(next); run(() => setGuardiansAction(person.id, next), "Parents updated"); }} />
                {a.name}
              </label>
            ))}
          </fieldset>
        ) : null}
      </Card>

      {role === "minor" && bodyPhotos ? (
        <Card className="space-y-3 border-x-0 border-b-0 border-t border-ink px-0 pt-4">
          <h2 className="mono text-graphite">Body photos</h2>
          <p className="text-[14px] leading-snug text-graphite">
            {bodyPhotos.allowed ? `Allowed · approved by ${bodyPhotos.approvedBy ?? "a parent"}. Seen only by ${name.split(" ")[0]} and parents.` : `Off. ${name.split(" ")[0]} can't add full-body photos until a parent approves.`}
          </p>
          {bodyPhotos.isParent ? (
            <Button variant="secondary" disabled={pending} data-testid="toggle-body-photos" onClick={() => run(() => setMinorBodyImageApprovalAction(person.id, !bodyPhotos.allowed), bodyPhotos.allowed ? "Body photos turned off and removed" : "Body photos approved")}>
              {bodyPhotos.allowed ? "Turn off body photos" : "Approve body photos"}
            </Button>
          ) : <p className="mono text-graphite">Only a parent of {name.split(" ")[0]} can change this</p>}
        </Card>
      ) : null}

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
        <Card className="space-y-3 border-x-0 border-b-0 border-t border-ink px-0 pt-4">
          <h2 className="mono text-graphite">Remove {person.name}</h2>
          <p className="text-[14px] leading-snug text-graphite">They lose access right away. You choose what happens to their clothes.</p>
          <Button variant="danger" onClick={() => setConfirmRemove(true)}>Remove person</Button>
        </Card>
      ) : null}

      <Sheet open={confirmRemove} onClose={() => setConfirmRemove(false)} title={`Remove ${first}?`}>
        <p className="text-[14px] leading-snug text-graphite">{first} loses access right away. What happens to the pieces in {first}’s closet?</p>
        <div className="mt-4 space-y-2">
          <Button variant="secondary" className="w-full" disabled={pending} onClick={() => run(() => removePersonAction(person.id, "moveToFamily"), `${first}’s pieces moved to the Family closet`)}>Move {first}’s pieces to Family</Button>
          <Button variant="danger" className="w-full" disabled={pending} onClick={() => run(() => removePersonAction(person.id, "delete"), `${first} and the pieces removed`)}>Delete the pieces too</Button>
          <button type="button" className="pill pill-quiet h-[50px] w-full" onClick={() => setConfirmRemove(false)}>Keep {first}</button>
        </div>
      </Sheet>
      <Sheet open={confirmRole !== null} onClose={() => setConfirmRole(null)} title={confirmRole === "admin" ? `Make ${first} an admin?` : `${first} stops being an admin?`}>
        <p className="text-[14px] leading-snug text-graphite">{confirmRole === "admin" ? `${first} can then see every closet, invite people, edit the lists and the rules, and approve body photos for minors.` : `${first} becomes ${confirmRole ? ROLE_WORD[confirmRole] : ""} and loses the admin pages.`}</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="pill pill-quiet h-[50px] flex-1" onClick={() => setConfirmRole(null)}>Not now</button>
          <Button className="flex-1" disabled={pending} data-testid="confirm-role" onClick={() => { const r = confirmRole!; setConfirmRole(null); setRole(r); run(() => setRoleAction(person.id, r), "Role updated"); }}>{confirmRole === "admin" ? "Make admin" : "Change role"}</Button>
        </div>
      </Sheet>
    </div>
  );
}

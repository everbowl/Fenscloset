"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { Sheet } from "@/components/ui/sheet";
import type { PersonSummary } from "@/lib/people/service";
import type { Role } from "@/generated/prisma/client";
import { removePersonAction, setGuardiansAction, setRoleAction, updatePersonAction } from "../actions";
import { InviteSheet } from "../invite-sheet";
import { setMinorBodyImageApprovalAction } from "@/app/(app)/profile/actions";

type Details = { name: string; email: string; phone: string; birthdate: string };
type DetailsState = null | "saving" | "saved" | { error: string };

export function PersonEditor({ person, admins, smsReady, isSelf, bodyPhotos }: { person: PersonSummary; admins: { id: string; name: string }[]; smsReady: boolean; isSelf: boolean; bodyPhotos: { allowed: boolean; approvedBy: string | null; isParent: boolean } | null }) {
  const router = useRouter();
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

  /** Runs an action; on failure says so and runs `revert`, so the screen never keeps a change the server refused (review A W5). */
  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string, revert?: () => void) {
    start(async () => {
      const r = await fn();
      if (r.ok) toast.ok(okText); else { revert?.(); toast.error(r.error ?? "Couldn’t save."); }
    });
  }

  // Details save when a field is left, if it changed; no Save button to find. The word lands beside the heading, not in a
  // toast the keyboard would cover (review A I1); a refused save stays dirty so the next blur tries again (W4).
  const last = useRef<Details>({ name: person.name, email: person.email ?? "", phone: person.phone ?? "", birthdate: person.birthdate ? person.birthdate.toISOString().slice(0, 10) : "" });
  const dirty = useRef(false);
  const [details, setDetails] = useState<DetailsState>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function saveDetails() {
    const next: Details = { name, email, phone, birthdate };
    const l = last.current;
    if (!dirty.current || (next.name === l.name && next.email === l.email && next.phone === l.phone && next.birthdate === l.birthdate)) return;
    dirty.current = false;
    setDetails("saving");
    start(async () => {
      const r = await updatePersonAction(person.id, { name, email: email || null, phone: phone || null, birthdate: birthdate || null });
      if (r.ok) {
        last.current = next;
        setDetails("saved");
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setDetails((s) => (s === "saved" ? null : s)), 2500);
      } else {
        dirty.current = true;
        setDetails({ error: r.error });
      }
    });
  }

  const ROLE_WORD: Record<Role, string> = { member: "a member", admin: "an admin (a parent)", minor: "a minor" };
  /** Applies a role. A new minor gets the admins as parents unless some were already picked (review A S5). */
  function applyRole(r: Role) {
    const before = { role, guardianIds };
    const parents = r === "minor" ? (guardianIds.length ? guardianIds : admins.filter((a) => a.id !== person.id).map((a) => a.id)) : guardianIds;
    setRole(r);
    if (r === "minor") setGuardianIds(parents);
    run(() => setRoleAction(person.id, r, r === "minor" ? parents : undefined), "Role updated", () => { setRole(before.role); setGuardianIds(before.guardianIds); });
  }
  function pickRole(r: Role) {
    if (r === role) return;
    // Giving or taking admin rights is the one change that asks first.
    if (r === "admin" || role === "admin") { setConfirmRole(r); return; }
    applyRole(r);
  }
  function toggleGuardian(id: string, on: boolean) {
    const before = guardianIds;
    const next = on ? [...guardianIds, id] : guardianIds.filter((x) => x !== id);
    setGuardianIds(next);
    run(() => setGuardiansAction(person.id, next), "Parents updated", () => setGuardianIds(before));
  }
  function remove(items: "delete" | "moveToFamily", okText: string) {
    start(async () => {
      const r = await removePersonAction(person.id, items);
      if (!r.ok) { toast.error(r.error); return; }
      setConfirmRemove(false);
      toast.ok(okText);
      router.push("/admin/people");
    });
  }

  return (
    <div className="flex flex-col gap-4">

      <section className="card flex flex-col gap-4 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="section">Details</h2>
          {details === "saving" ? <span className="caption" role="status">Saving…</span>
            : details === "saved" ? <span className="caption text-ink" role="status" data-testid="details-saved">✓ Saved</span>
            : null}
        </div>
        {details && typeof details === "object" ? <p className="text-[15px] leading-snug" role="alert" data-testid="details-error">— {details.error}</p> : null}
        <Field label="Name" htmlFor="p-name" hint="Saves when you leave the field."><Input id="p-name" value={name} onChange={(e) => { dirty.current = true; setName(e.target.value); }} onBlur={saveDetails} autoComplete="name" /></Field>
        <Field label="Email" htmlFor="p-email" hint="Used to sign in."><Input id="p-email" type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => { dirty.current = true; setEmail(e.target.value); }} onBlur={saveDetails} /></Field>
        <Field label="Mobile number" htmlFor="p-phone"><Input id="p-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => { dirty.current = true; setPhone(e.target.value); }} onBlur={saveDetails} /></Field>
        <Field label="Birthday" htmlFor="p-bday"><Input id="p-bday" type="date" value={birthdate} onChange={(e) => { dirty.current = true; setBirthdate(e.target.value); }} onBlur={saveDetails} /></Field>
      </section>

      <section className="card flex flex-col gap-4 p-4">
        <h2 className="section">Role</h2>
        <Field label="Role" htmlFor="p-role">
          <Select id="p-role" value={role} disabled={isSelf} onChange={(e) => pickRole(e.target.value as Role)}>
            <option value="member">Member (adult)</option>
            <option value="admin">Admin (parent)</option>
            <option value="minor">Minor (under 18)</option>
          </Select>
          {isSelf ? <p className="note mt-1">You can&apos;t change your own role.</p> : null}
        </Field>
        {role === "minor" ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="mono text-graphite">Parent admins</legend>
            {admins.filter((a) => a.id !== person.id).map((a) => (
              <label key={a.id} className="flex h-11 items-center gap-3 text-[15px]">
                <input type="checkbox" className="size-5 accent-black" checked={guardianIds.includes(a.id)} onChange={(e) => toggleGuardian(a.id, e.target.checked)} />
                {a.name}
              </label>
            ))}
            <p className="note">A minor&apos;s body data and shopping stay with them and their parents; anything they had shared is taken back.</p>
          </fieldset>
        ) : null}
      </section>

      {role === "minor" && bodyPhotos ? (
        <section className="card flex flex-col gap-3 p-4">
          <h2 className="section">Body photos</h2>
          <p className="note">
            {bodyPhotos.allowed ? `Allowed · approved by ${bodyPhotos.approvedBy ?? "a parent"}. Seen only by ${first} and parents.` : `Off. ${first} can't add full-body photos until a parent approves.`}
          </p>
          {bodyPhotos.isParent ? (
            <Button variant="outline" busy={pending} data-testid="toggle-body-photos" onClick={() => run(() => setMinorBodyImageApprovalAction(person.id, !bodyPhotos.allowed), bodyPhotos.allowed ? "Body photos turned off and removed" : "Body photos approved")}>
              {bodyPhotos.allowed ? "Turn off body photos" : "Approve body photos"}
            </Button>
          ) : <p className="caption">Only a parent of {first} can change this</p>}
        </section>
      ) : null}

      <section className="card flex flex-col gap-3 p-4">
        <h2 className="section">Login</h2>
        <p className="note">
          {person.hasPassword ? "Has a password and can sign in." : person.pendingInvite ? "An invite is out. Send another if it got lost." : "Hasn't set a password yet. Send an invite."}
        </p>
        <InviteSheet admins={admins} smsReady={smsReady} existing={{ id: person.id, name, email: email || null, phone: phone || null, role, guardianIds }}
          trigger={<Button variant="outline">{person.hasPassword ? "Send a new invite link" : "Send invite"}</Button>} />
      </section>

      {!isSelf ? (
        <section className="card flex flex-col gap-3 p-4">
          <h2 className="section">Remove {person.name}</h2>
          <p className="note">They lose access right away. You choose what happens to their clothes.</p>
          <Button variant="danger" onClick={() => setConfirmRemove(true)}>Remove person</Button>
        </section>
      ) : null}

      <Sheet open={confirmRemove} onClose={() => setConfirmRemove(false)} title={`Remove ${first}?`}>
        <p className="note">{first} loses access right away. What happens to the pieces in {first}’s closet?</p>
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="secondary" className="w-full" busy={pending} onClick={() => remove("moveToFamily", `${first}’s pieces moved to the Family closet`)}>Move {first}’s pieces to Family</Button>
          <Button variant="danger" className="w-full" disabled={pending} onClick={() => remove("delete", `${first} and the pieces removed`)}>Delete the pieces too</Button>
          <button type="button" className="pill pill-quiet h-12 w-full" onClick={() => setConfirmRemove(false)}>Keep {first}</button>
        </div>
      </Sheet>
      <Sheet open={confirmRole !== null} onClose={() => setConfirmRole(null)} title={confirmRole === "admin" ? `Make ${first} an admin?` : `${first} stops being an admin?`}>
        <p className="note">{confirmRole === "admin" ? `${first} can then see every closet, invite people, edit the lists and the rules, and approve body photos for minors.` : `${first} becomes ${confirmRole ? ROLE_WORD[confirmRole] : ""} and loses the admin pages.`}</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="pill pill-quiet h-12 flex-1" onClick={() => setConfirmRole(null)}>Not now</button>
          <Button className="flex-1" disabled={pending} data-testid="confirm-role" onClick={() => { const r = confirmRole!; setConfirmRole(null); applyRole(r); }}>{confirmRole === "admin" ? "Make admin" : "Change role"}</Button>
        </div>
      </Sheet>
    </div>
  );
}

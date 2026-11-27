"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { InviteLink } from "./invite-link";
import { cancelInviteAction, renewInviteAction, type InviteResult } from "./actions";

export type OpenInviteRow = { id: string; name: string; email: string | null; phone: string | null; role: string; expiresAt: string };

function daysLeft(iso: string): string {
  const days = Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
  return days === 0 ? "expires today" : days === 1 ? "1 day left" : `${days} days left`;
}

/**
 * Invites that nobody has accepted yet and that have no row on the People list (review A W6). Only the hash of a link is
 * kept, so "New link" and "Send again" both make a fresh one and retire the old; "Cancel" retires it with nothing new.
 */
export function OpenInvites({ invites, smsReady }: { invites: OpenInviteRow[]; smsReady: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<{ id: string; what: "send" | "link" | "cancel" } | null>(null);
  const [link, setLink] = useState<{ invite: OpenInviteRow; result: InviteResult } | null>(null);
  const [cancelling, setCancelling] = useState<OpenInviteRow | null>(null);
  if (!invites.length) return null;

  function renew(invite: OpenInviteRow, send: boolean) {
    setBusy({ id: invite.id, what: send ? "send" : "link" });
    start(async () => {
      const result = await renewInviteAction(invite.id, send);
      setBusy(null);
      if (!result.ok) { toast.error(result.error); return; }
      setLink({ invite, result });
      router.refresh();
    });
  }
  function cancel(invite: OpenInviteRow) {
    setCancelling(null);
    setBusy({ id: invite.id, what: "cancel" });
    start(async () => {
      const r = await cancelInviteAction(invite.id);
      setBusy(null);
      if (!r.ok) { toast.error(r.error); return; }
      toast.ok(`Invite for ${invite.name} cancelled`);
      router.refresh();
    });
  }

  return (
    <section className="mt-7" data-testid="open-invites">
      <h2 className="section mb-1">Invited · waiting to accept</h2>
      <p className="note mb-3">They are not on the list until they open their link and set a password.</p>
      <ul className="flex flex-col gap-2">
        {invites.map((i) => {
          const canSend = Boolean(i.email) || (Boolean(i.phone) && smsReady);
          const mine = pending && busy?.id === i.id ? busy.what : null;
          return (
            <li key={i.id} className="card p-3" data-testid="open-invite">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-medium leading-tight">{i.name}</span>
                  <span className="caption block truncate">{i.email ?? i.phone ?? "No email or phone"} · {daysLeft(i.expiresAt)}</span>
                </span>
                <span className="pill pill-sm pointer-events-none shrink-0">{i.role}</span>
              </div>
              <div className="strip mt-3 gap-2">
                {canSend ? <Button size="sm" variant="secondary" busy={mine === "send"} disabled={mine !== null} onClick={() => renew(i, true)} data-testid="invite-resend">Send again</Button> : null}
                <Button size="sm" variant="outline" busy={mine === "link"} disabled={mine !== null} onClick={() => renew(i, false)} data-testid="invite-new-link">New link</Button>
                <button type="button" className="pill pill-quiet" disabled={mine !== null} onClick={() => setCancelling(i)} data-testid="invite-cancel">{mine === "cancel" ? "Cancelling…" : "Cancel invite"}</button>
              </div>
            </li>
          );
        })}
      </ul>

      <Sheet open={link !== null} onClose={() => setLink(null)} title={link ? `Link for ${link.invite.name}` : "Link"}>
        {link?.result.ok ? (
          <InviteLink result={link.result} name={link.invite.name} email={link.invite.email ?? ""} phone={link.invite.phone ?? ""} onDone={() => setLink(null)}
            note="This is a new link; the one before it stopped working." />
        ) : null}
      </Sheet>

      <Sheet open={cancelling !== null} onClose={() => setCancelling(null)} title={cancelling ? `Cancel ${cancelling.name}'s invite?` : "Cancel?"}>
        <p className="note">The link stops working right away. You can invite them again any time.</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="pill h-12 flex-1" onClick={() => setCancelling(null)}>Keep it</button>
          <Button variant="secondary" className="flex-1" onClick={() => cancelling && cancel(cancelling)} data-testid="invite-cancel-confirm">Cancel invite</Button>
        </div>
      </Sheet>
    </section>
  );
}

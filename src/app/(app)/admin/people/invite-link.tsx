"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { InviteResult } from "./actions";

/**
 * The link an invite produced, with Copy and Share. On a phone the clipboard can refuse (plain http, or a share that was
 * dismissed), so a failure says what to do instead of nothing (review A I3).
 */
export function InviteLink({ result, name, email, phone, onDone, note }: { result: Extract<InviteResult, { ok: true }>; name: string; email: string; phone: string; onDone: () => void; note?: string }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);

  async function copy(url: string) {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(url);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
    setTimeout(() => setCopied(null), 3000);
  }
  async function share(url: string) {
    if (!navigator.share) return copy(url);
    try { await navigator.share({ title: "Fen's Closet invite", text: `${name}, set up your closet:`, url }); }
    catch { /* the share sheet was dismissed; the link is still on the screen */ }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card bg-bone p-4" role="status">
        <p className="text-[15px] font-semibold">Invite created</p>
        <p className="note mt-1">
          {result.delivered.email ? `Email sent to ${email}. ` : ""}{result.delivered.sms ? `Text sent to ${phone}. ` : ""}
          The link works for 7 days.{note ? ` ${note}` : ""}
        </p>
      </div>
      {result.deliveryError ? <p className="text-[15px] leading-snug" role="alert">— {result.deliveryError}</p> : null}
      <div data-testid="invite-url" className="stage select-all break-all p-3 text-[13px] leading-snug">{result.url}</div>
      {copied === "no" ? <p className="caption" role="alert">Couldn&apos;t copy — long-press the link above to copy it.</p> : null}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => copy(result.url)}>{copied === "yes" ? <Check className="size-4" /> : <Copy className="size-4" />} {copied === "yes" ? "Copied" : "Copy link"}</Button>
        <Button variant="secondary" className="flex-1" onClick={() => share(result.url)}><Share2 className="size-4" /> Share…</Button>
      </div>
      <button type="button" className="pill pill-quiet h-12 w-full" onClick={onDone}>Done</button>
    </div>
  );
}

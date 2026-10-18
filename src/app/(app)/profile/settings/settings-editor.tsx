"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { PickSheet, Row, TextSheet } from "@/components/items/row-editor";
import type { Named, PrivacyView } from "@/lib/profiles/service";
import { disconnectCalendarAction, setBodyViewersAction, setSavedZipAction, setShoppersAction } from "../actions";

/** Settings (screen 14, undrawn): saved zip, who sees my body profile, who shops for me, password, calendar (Phase 3). */
type CalendarInfo = { configured: boolean; connected: boolean; email: string | null; notice: string | null };
const NOTICE: Record<string, string> = {
  connected: "Google Calendar connected. Today’s plan comes from your next event.",
  denied: "Google didn’t give access. Try again and tap Allow.",
  mismatch: "That connection link wasn’t for this account. Try again.",
  failed: "Google Calendar couldn’t be connected. Try again in a minute.",
  unconfigured: "Google Calendar isn’t set up on the site yet.",
};

export function SettingsEditor({ privacy, people, calendar }: { privacy: PrivacyView; people: Named[]; calendar: CalendarInfo }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<"zip" | "viewers" | "shoppers" | null>(null);
  const [error, setError] = useState<string>();
  const [, start] = useTransition();
  const names = (ids: string[]) => ids.map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(", ");
  const parents = names(privacy.parentIds);
  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(undefined);
    start(async () => { const r = await fn(); if (!r.ok) setError(r.error); router.refresh(); });
  }
  return (
    <div className="space-y-6">
      {error ? <Banner tone="danger" title={error} /> : null}
      {calendar.notice && NOTICE[calendar.notice] ? <Banner tone="info" title={NOTICE[calendar.notice]} /> : null}
      <section>
        <p className="mono border-b border-ink pb-2 text-graphite">Weather</p>
        <Row label="Saved zip" value={privacy.savedZip ?? "Ask each day"} muted={!privacy.savedZip} onClick={() => setSheet("zip")} testId="row-zip" />
      </section>
      <section>
        <p className="mono border-b border-ink pb-2 text-graphite">Privacy</p>
        {privacy.canGrant ? (
          <>
            <Row label="Body profile" value={privacy.bodyViewerIds.length ? `Me, ${names(privacy.bodyViewerIds)}` : "Only me"} onClick={() => setSheet("viewers")} testId="row-body-viewers" />
            <Row label="Shop for me" value={privacy.shopperIds.length ? names(privacy.shopperIds) : "Nobody"} muted={!privacy.shopperIds.length} onClick={() => setSheet("shoppers")} testId="row-shoppers" />
          </>
        ) : (
          <>
            <div className="flex h-[42px] items-center border-b border-line"><span className="mono w-[120px] shrink-0 text-graphite">Body profile</span><span className="text-[14px]">Me{parents ? `, ${parents}` : ""}</span></div>
            <div className="flex h-[42px] items-center border-b border-line"><span className="mono w-[120px] shrink-0 text-graphite">Shop for me</span><span className="text-[14px]">{parents || "Parents"}</span></div>
            <p className="mono pt-2 text-graphite">Your body profile stays with you and your parents</p>
          </>
        )}
      </section>
      <section>
        <p className="mono border-b border-ink pb-2 text-graphite">Account</p>
        <Link href="/change-password" className="flex h-[42px] items-center justify-between border-b border-line text-[14px]">Change password<span className="mono text-graphite">→</span></Link>
        <div className="flex min-h-[42px] items-center justify-between gap-3 border-b border-line text-[14px]" data-testid="row-calendar">
          <span className="min-w-0"><span className="block">Google Calendar</span>{calendar.connected ? <span className="mono block truncate text-graphite">{calendar.email ?? "Connected"}</span> : null}</span>
          {calendar.connected
            ? <button type="button" onClick={() => run(() => disconnectCalendarAction())} className="mono mono-11 shrink-0 py-2">Disconnect</button>
            : calendar.configured
              ? <a href="/api/google/connect" className="mono mono-11 shrink-0 py-2" data-testid="connect-calendar">Connect</a>
              : <span className="mono shrink-0 text-graphite">Not set up yet</span>}
        </div>
      </section>
      <TextSheet open={sheet === "zip"} onClose={() => setSheet(null)} title="Saved zip" label="Zip code" value={privacy.savedZip ?? ""} placeholder="92101" onSave={(v) => run(() => setSavedZipAction(v))} />
      <PickSheet open={sheet === "viewers"} onClose={() => setSheet(null)} title="Who sees my body profile" kind="tag" options={people} selected={privacy.bodyViewerIds} multi canAdd={false} onChange={(ids) => run(() => setBodyViewersAction(ids))} />
      <PickSheet open={sheet === "shoppers"} onClose={() => setSheet(null)} title="Who can shop for me" kind="tag" options={people} selected={privacy.shopperIds} multi canAdd={false} onChange={(ids) => run(() => setShoppersAction(ids))} />
    </div>
  );
}

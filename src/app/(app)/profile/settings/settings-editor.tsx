"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { PickSheet, Row, TextSheet } from "@/components/items/row-editor";
import type { Named, PrivacyView } from "@/lib/profiles/service";
import { ENGINE_WORD } from "@/lib/tryon/engines";
import { PhoneSignInCode } from "@/components/auth/phone-code";
import { disconnectCalendarAction, listCalendarsAction, setBodyViewersAction, setCalendarIdsAction, setSavedZipAction, setShoppersAction, setShopSectionAction, setTryOnEnabledAction } from "../actions";

/** Settings (screen 14, undrawn): saved zip, who sees my body profile, who shops for me, password, calendar (Phase 3). */
type CalendarInfo = { configured: boolean; connected: boolean; email: string | null; /** Google refused the saved token: the connection must be made again. */ needsReconnect: boolean; notice: string | null; calendarIds: string[] };
type CalendarChoice = { id: string; name: string; primary: boolean };
const NOTICE: Record<string, string> = {
  connected: "Google Calendar connected. Today’s plan comes from your next event.",
  denied: "Google didn’t give access. Try again and tap Allow.",
  mismatch: "That connection link wasn’t for this account. Try again.",
  failed: "Google Calendar couldn’t be connected. Try again in a minute.",
  unconfigured: "Google Calendar isn’t set up on the site yet.",
};

/** A group of rows under one heading, on a card. */
function Group({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section data-testid={testId}>
      <h2 className="section">{title}</h2>
      <div className="card mt-3 px-4">{children}</div>
    </section>
  );
}

export function SettingsEditor({ privacy, people, calendar }: { privacy: PrivacyView; people: Named[]; calendar: CalendarInfo }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<"zip" | "viewers" | "shoppers" | "calendars" | "section" | null>(null);
  // The calendar list is Google's answer, read only when the row is tapped (review E G1: the page used to wait on it).
  const [calendars, setCalendars] = useState<CalendarChoice[] | null>(null);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const calendarWords = calendar.calendarIds.length ? (calendars ? calendar.calendarIds.map((id) => calendars.find((c) => c.id === id)?.name ?? id).join(", ") : `${calendar.calendarIds.length} picked`) : "Primary only";
  const [error, setError] = useState<string>();
  const [, start] = useTransition();
  const names = (ids: string[]) => ids.map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(", ");
  const parents = names(privacy.parentIds);
  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(undefined);
    start(async () => { const r = await fn(); if (!r.ok) setError(r.error); router.refresh(); });
  }
  function openCalendars() {
    setError(undefined);
    if (calendars) { setSheet("calendars"); return; }
    setLoadingCalendars(true);
    start(async () => {
      const r = await listCalendarsAction();
      setLoadingCalendars(false);
      if (!r.ok) { setError(r.error); return; }
      setCalendars(r.calendars); setSheet("calendars");
    });
  }
  return (
    <div className="space-y-8">
      {error ? <Banner tone="danger" title={error} /> : null}
      {calendar.notice && NOTICE[calendar.notice] ? <Banner tone="info" title={NOTICE[calendar.notice]} /> : null}
      <Group title="Weather">
        <Row label="Saved zip" value={privacy.savedZip ?? "Ask each day"} muted={!privacy.savedZip} onClick={() => setSheet("zip")} testId="row-zip" />
      </Group>
      <Group title="Shopping">
        <Row label="Shops in" value={privacy.shopSection?.name ?? "Pick a section"} muted={!privacy.shopSection} onClick={() => setSheet("section")} testId="row-section" />
        <p className="note py-3">Men's, Women's, Boys', Girls'… Every store search carries it, so the other section stays out.</p>
      </Group>
      <Group title="Privacy">
        {privacy.canGrant ? (
          <>
            <Row label="Body profile" value={privacy.bodyViewerIds.length ? `Me, ${names(privacy.bodyViewerIds)}` : "Only me"} onClick={() => setSheet("viewers")} testId="row-body-viewers" />
            <Row label="Shop for me" value={privacy.shopperIds.length ? names(privacy.shopperIds) : "Nobody"} muted={!privacy.shopperIds.length} onClick={() => setSheet("shoppers")} testId="row-shoppers" />
          </>
        ) : (
          <>
            <div className="flex h-12 items-center border-b border-line"><span className="mono w-[120px] shrink-0 text-graphite">Body profile</span><span className="text-[15px]">Me{parents ? `, ${parents}` : ""}</span></div>
            <div className="flex h-12 items-center border-b border-line"><span className="mono w-[120px] shrink-0 text-graphite">Shop for me</span><span className="text-[15px]">{parents || "Parents"}</span></div>
            <p className="note py-3">Your body profile stays with you and your parents</p>
          </>
        )}
      </Group>
      {privacy.tryOn.adult ? (
        <Group title="Try-on" testId="tryon-section">
          <div className="flex min-h-12 items-center justify-between gap-3 py-2">
            <span className="min-w-0"><span className="block text-[15px]">Show me wearing a look</span><span className="caption block">{privacy.tryOn.configured ? (privacy.tryOn.enabled ? `On · your body photo is sent to ${privacy.tryOn.engines.map((e) => ENGINE_WORD[e]).join(" and ") || "the dressing service"} to make the picture` : "Off") : "Not set up on the site yet"}</span></span>
            <button type="button" role="switch" aria-checked={privacy.tryOn.enabled} disabled={!privacy.tryOn.configured} onClick={() => run(() => setTryOnEnabledAction(!privacy.tryOn.enabled))} className={`pill pill-sm shrink-0 ${privacy.tryOn.enabled ? "pill-solid" : ""}`} data-testid="tryon-toggle">{privacy.tryOn.enabled ? "On" : "Off"}</button>
          </div>
          {privacy.tryOn.enabled && !privacy.tryOn.hasBodyPhoto ? <p className="note pb-2">Add a full-body photo on your <Link href="/profile/body" className="text-ink underline underline-offset-4">Body page</Link> so it has something to dress</p> : null}
          <p className="note pb-3">Pictures are yours alone. Never for kids.</p>
        </Group>
      ) : null}
      <Group title="Account">
        <Link href="/change-password" className="tap flex h-12 items-center justify-between border-b border-line text-[15px]">Change password<span className="mono text-graphite">→</span></Link>
        {/* A six-digit code signs this same person in on another phone, no typed password (brief §4; admins). */}
        {privacy.isAdmin ? <PhoneSignInCode /> : null}
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-2 text-[15px]" data-testid="row-calendar">
          <span className="min-w-0"><span className="block">Google Calendar</span>{calendar.connected ? <span className="caption block truncate">{calendar.email ?? "Connected"}</span> : null}</span>
          {calendar.connected
            ? <button type="button" onClick={() => run(() => disconnectCalendarAction())} className="pill pill-sm shrink-0">Disconnect</button>
            : calendar.configured
              ? <a href="/api/google/connect" className="pill pill-sm pill-solid shrink-0" data-testid="connect-calendar">Connect</a>
              : <span className="caption shrink-0">Not set up yet</span>}
        </div>
        {calendar.connected && calendar.needsReconnect ? (
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-2" role="status" data-testid="calendar-reconnect">
            <span className="min-w-0"><span className="block text-[15px]">Calendar needs reconnecting</span><span className="caption block">Google stopped accepting the saved connection, so Today has no plan from it.</span></span>
            <a href="/api/google/connect" className="pill pill-sm pill-solid shrink-0" data-testid="reconnect-calendar">Reconnect</a>
          </div>
        ) : null}
        {calendar.connected ? <Row label="Calendars" value={loadingCalendars ? "Asking Google…" : calendarWords} onClick={openCalendars} testId="row-calendars" /> : null}
      </Group>
      <TextSheet open={sheet === "zip"} onClose={() => setSheet(null)} title="Saved zip" label="Zip code" kind="zip" value={privacy.savedZip ?? ""} placeholder="92101" onSave={(v) => run(() => setSavedZipAction(v))} />
      <PickSheet open={sheet === "section"} onClose={() => setSheet(null)} title="I shop in" kind="shopSection" options={privacy.sections} selected={privacy.shopSection ? [privacy.shopSection.id] : []} canAdd={privacy.isAdmin} onChange={(ids) => { setSheet(null); run(() => setShopSectionAction(null, ids[0] ?? null)); }} clearable />
      <PickSheet open={sheet === "viewers"} onClose={() => setSheet(null)} title="Who sees my body profile" kind="tag" options={people} selected={privacy.bodyViewerIds} multi canAdd={false} onChange={(ids) => run(() => setBodyViewersAction(ids))} />
      <PickSheet open={sheet === "calendars"} onClose={() => setSheet(null)} title="Which calendars count" kind="tag" options={(calendars ?? []).map((c) => ({ id: c.id, name: c.primary ? `${c.name} (primary)` : c.name }))} selected={calendar.calendarIds} multi canAdd={false} onChange={(ids) => run(() => setCalendarIdsAction(ids))} />
      <PickSheet open={sheet === "shoppers"} onClose={() => setSheet(null)} title="Who can shop for me" kind="tag" options={people} selected={privacy.shopperIds} multi canAdd={false} onChange={(ids) => run(() => setShoppersAction(ids))} />
    </div>
  );
}

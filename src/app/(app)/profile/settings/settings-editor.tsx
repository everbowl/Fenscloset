"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { PickSheet, Row, TextSheet } from "@/components/items/row-editor";
import type { Named, PrivacyView } from "@/lib/profiles/service";
import { setBodyViewersAction, setSavedZipAction, setShoppersAction } from "../actions";

/** Settings (screen 14, undrawn): saved zip, who sees my body profile, who shops for me, password, calendar (Phase 3). */
export function SettingsEditor({ privacy, people }: { privacy: PrivacyView; people: Named[] }) {
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
        <div className="flex h-[42px] items-center justify-between border-b border-line text-[14px]"><span>Google Calendar</span><span className="mono text-graphite">Phase 3</span></div>
      </section>
      <TextSheet open={sheet === "zip"} onClose={() => setSheet(null)} title="Saved zip" label="Zip code" value={privacy.savedZip ?? ""} placeholder="92101" onSave={(v) => run(() => setSavedZipAction(v))} />
      <PickSheet open={sheet === "viewers"} onClose={() => setSheet(null)} title="Who sees my body profile" kind="tag" options={people} selected={privacy.bodyViewerIds} multi canAdd={false} onChange={(ids) => run(() => setBodyViewersAction(ids))} />
      <PickSheet open={sheet === "shoppers"} onClose={() => setSheet(null)} title="Who can shop for me" kind="tag" options={people} selected={privacy.shopperIds} multi canAdd={false} onChange={(ids) => run(() => setShoppersAction(ids))} />
    </div>
  );
}

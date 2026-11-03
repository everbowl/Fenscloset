"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Need } from "@/lib/closet/needs";
import type { CategorySizes } from "@/lib/profiles/sizes";
import type { LikelySizes } from "@/lib/profiles/size-options";
import { PhotoPrivacySheet, useBodyPhotoUpload } from "@/components/profile/body-photo-upload";
import { MyBrandSheet } from "@/components/profile/my-brand-sheet";
import { SectionPick } from "@/components/shop/section-pick";
import { snoozeNeedAction } from "./needs-actions";

type Named = { id: string; name: string };
/** Rows shown before "n more". */
const SHOWN = 3;

/**
 * "What's needed" at the top of your own closet (Jeff, 2 Nov 2026; D1): one row per gap with the fix in the row
 * (the photo picker, the size sheet, the section pills, a link to the pieces), and Not now to hide a row for a
 * while (Admin → Rules says how long). Three rows show; the rest wait behind "n more".
 */
export function NeedsStrip({ personId, needs, sections, isAdmin, sizeOptions, likely, visibleTo }: {
  personId: string; needs: Need[]; sections: Named[]; isAdmin: boolean; sizeOptions: CategorySizes[]; likely: LikelySizes | null;
  /** Who sees a shared body photo (the privacy ask's "Currently …" line). */ visibleTo: string[];
}) {
  const router = useRouter();
  const [gone, setGone] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [ask, setAsk] = useState<"front" | "back" | null>(null);
  const [sizing, setSizing] = useState<Need | null>(null);
  const [error, setError] = useState<string>();
  const [, start] = useTransition();
  const upload = useBodyPhotoUpload(personId, () => router.refresh(), "need-body-photo");
  const live = needs.filter((n) => !gone.includes(n.key));
  if (!live.length) return null;
  const rows = all ? live : live.slice(0, SHOWN);
  const shownError = error ?? upload.error;
  // Not now hides the row at once; the server remembers for how long. A failure brings the row back with the reason.
  const notNow = (key: string) => {
    setGone((g) => [...g, key]);
    start(async () => { const r = await snoozeNeedAction(key); if (!r.ok) { setError(r.error); setGone((g) => g.filter((k) => k !== key)); } router.refresh(); });
  };
  const action = (n: Need) => {
    switch (n.kind) {
      case "body-front": case "body-back": case "body-retake": {
        const v = n.view ?? "front";
        return (
          <button type="button" onClick={() => setAsk(v)} disabled={Boolean(upload.uploading)} className="pill pill-sm pill-solid" data-testid={`need-add-${n.key}`}>
            {upload.uploading === v ? "Saving…" : n.kind === "body-retake" ? `Retake ${v}` : `Add ${v} photo`}
          </button>
        );
      }
      case "section": return <SectionPick personId={personId} forName="" mine section={null} sections={sections} isAdmin={isAdmin} bare />;
      case "size": return <button type="button" onClick={() => setSizing(n)} className="pill pill-sm pill-solid" data-testid={`need-add-${n.key}`}>Add size</button>;
      case "store-photos": return <Link href="/closet?store=1" className="pill pill-sm pill-solid" data-testid="need-see-store-photos">See them</Link>;
    }
  };

  return (
    <section className="mt-4 border-y border-ink py-2" data-testid="needs" aria-label="What’s needed">
      <div className="flex items-center justify-between py-1">
        <h2 className="mono tracking-[0.1em]">What’s needed</h2>
        <span className="mono text-graphite" data-testid="needs-count">{live.length}</span>
      </div>
      {rows.map((n) => (
        <div key={n.key} className="flex flex-col gap-2 border-t border-line py-2.5" data-testid={`need-${n.key}`}>
          <div>
            <p className="text-[15px] leading-snug">{n.title}</p>
            <p className="mono mt-0.5 text-graphite">{n.detail}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {action(n)}
            <button type="button" onClick={() => notNow(n.key)} className="pill pill-sm pill-quiet" data-testid={`need-not-now-${n.key}`}>Not now</button>
          </div>
        </div>
      ))}
      {live.length > SHOWN ? <button type="button" onClick={() => setAll((a) => !a)} className="mono mt-1 py-2 text-graphite underline underline-offset-4" data-testid="needs-more">{all ? "Fewer" : `${live.length - SHOWN} more`}</button> : null}
      {shownError ? <p className="mono mt-1 text-danger" role="alert">{shownError}</p> : null}
      {upload.input}
      <PhotoPrivacySheet open={Boolean(ask)} onClose={() => setAsk(null)} visibleTo={visibleTo} testIdPrefix="need-photo" onPick={(onlyMe) => { const v = ask; setAsk(null); if (v) upload.pick(v, onlyMe); }} />
      {sizing?.brandId ? (
        <MyBrandSheet key={sizing.brandId} ownerId={personId} brand={{ brandId: sizing.brandId, name: sizing.brandName ?? "", url: sizing.brandUrl ?? null, sizes: [] }} sizeOptions={sizeOptions} likely={likely}
          onClose={() => setSizing(null)} onSaved={() => router.refresh()} onError={setError} />
      ) : null}
    </section>
  );
}

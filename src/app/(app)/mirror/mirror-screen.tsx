"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect } from "react";
import type { TryOnView } from "@/lib/tryon";
import type { MirrorConfig } from "@/lib/tryon/config";
import { MirrorBody, MirrorGlyph } from "@/components/mirror/mirror-sheet";
import { useMirror } from "@/components/mirror/use-mirror";
import { PageHeader } from "@/components/ui/page-header";

export function MirrorScreen({ config, recent }: { config: MirrorConfig; recent: TryOnView[] }) {
  const m = useMirror(config.personId, config.wardrobe, config.engine);
  const markSeen = m.jobs.markSeen;
  useEffect(() => { markSeen(); }, [markSeen, m.tryOn]);
  const showing = Boolean(m.tryOn || m.busy || m.pending || m.error);
  const names = (ids: string[]) => { const known = m.piecesOf(ids); return known.length ? known.map((p) => p.name).join(" · ") : "A look"; };
  const pieces = m.jobs.job?.pieces || (m.tryOn ? names(m.tryOn.itemIds) : "");
  const canDress = config.tryOn === "ready" || config.mannequinAvailable;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Mirror" aside={m.busy ? "Dressing…" : m.tryOn ? "Your look" : undefined} />
      {showing ? (
        <MirrorBody m={m} inline pieces={pieces} mine personId={config.personId} personName={config.personName} tryOnState={config.tryOn} backPhoto={config.backPhoto} bodyOnlyMe={config.bodyOnlyMe} mannequinAvailable={config.mannequinAvailable} admin={config.admin} />
      ) : (
        <div className="card flex flex-col items-center gap-3 py-8 text-center" data-testid="mirror-empty">
          <div className="h-[140px] w-[94px] opacity-70"><MirrorGlyph /></div>
          <p className="section">Nothing in the mirror yet</p>
          <p className="note max-w-[300px]">{canDress ? "Pick a look on Today, or pieces in your closet, and tap the mirror. It keeps dressing while you do other things." : config.tryOn === "no_photo" ? "Add a full-body photo in a plain fitted t-shirt and pants, and the mirror can dress you." : config.tryOn === "off" ? "Turn on try-on in Settings and the mirror can dress you." : "The mirror isn’t set up on the site yet."}</p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <Link href="/today" className="pill pill-solid">Today’s looks</Link>
            <Link href="/closet" className="pill">Pick pieces</Link>
            {config.tryOn === "no_photo" ? <Link href="/profile/body" className="pill">Add a body photo</Link> : config.tryOn === "off" ? <Link href="/profile/settings" className="pill">Settings</Link> : null}
          </div>
        </div>
      )}
      {recent.length ? (
        <section className="flex flex-col gap-2" data-testid="mirror-recent">
          <h2 className="section">Recent looks</h2>
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
            {recent.map((r) => (
              <button key={r.id} type="button" onClick={() => m.jobs.restore(config.personId, r, { kind: "closet", itemIds: r.itemIds }, names(r.itemIds))} className="stage aspect-[3/4] overflow-hidden rounded-xl text-left" aria-label={`Show ${names(r.itemIds)}`} data-testid="mirror-recent-look">
                <img src={`/api/photo/${r.key}`} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

"use client";

/* eslint-disable @next/next/no-img-element */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { shrinkPhoto } from "@/lib/import/client-queue";
import type { InspirationView } from "@/lib/profiles/inspiration";
import { addInspirationAction, removeInspirationAction } from "../actions";

/**
 * Inspiration board: screenshots of looks the person wants to dress like. Each tile opens a sheet
 * with what Claude read from it (style DNA) and REMOVE. The + tile uploads a new one.
 */
export function InspirationBoard({ ownerId, looks, canEdit, isMinor }: { ownerId: string; looks: InspirationView[]; canEdit: boolean; isMinor: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<InspirationView | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    setBusy("upload"); setError(undefined);
    try {
      const blob = await shrinkPhoto(f, 1600);
      const signRes = await fetch("/api/uploads/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: blob.type || "image/jpeg", kind: "inspo", ownerId }) });
      const signed = (await signRes.json()) as { key: string; url: string; headers: Record<string, string>; error?: string };
      if (!signRes.ok) throw new Error(signed.error || "Upload failed.");
      const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: blob });
      if (!put.ok) throw new Error("Upload failed.");
      const r = await addInspirationAction(ownerId, signed.key);
      if (!r.ok) throw new Error(r.error);
      router.refresh();
    } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  }
  function remove(id: string) {
    setBusy("remove");
    start(async () => { const r = await removeInspirationAction(ownerId, id); setBusy(null); if (!r.ok) setError(r.error); setOpen(null); router.refresh(); });
  }

  return (
    <section data-testid="inspiration">
      <div className="flex items-end justify-between border-b border-ink pb-2">
        <p className="mono text-graphite">Inspiration · looks to dress like</p>
        <p className="mono text-graphite">{looks.length ? `${looks.length} saved` : ""}</p>
      </div>
      {error ? <Banner tone="danger" title={error} className="mt-3" /> : null}
      <p className="mt-3 text-[14px] leading-snug text-graphite">Screenshots of outfits you like: Instagram, Pinterest, a magazine. The looks it builds for you follow these. Seen by {isMinor ? "you and your parents" : "you"} only.</p>
      <div className="mt-3 grid grid-cols-3 gap-[6px]">
        {canEdit ? (
          <button type="button" disabled={busy !== null} onClick={() => file.current?.click()} className="flex h-[150px] flex-col items-center justify-center gap-2 border border-ink bg-paper" data-testid="add-inspiration">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 4v16M4 12h16" /></svg>
            <span className="mono">{busy === "upload" ? "Reading…" : "Add a look"}</span>
          </button>
        ) : null}
        {looks.map((l) => (
          <button key={l.id} type="button" onClick={() => setOpen(l)} className="h-[150px] overflow-hidden bg-bone" aria-label={l.notes.summary} data-testid="inspiration-tile">
            <img src={`/api/photo/${l.key}`} alt="" className="size-full object-cover" />
          </button>
        ))}
      </div>
      {!looks.length && !canEdit ? <p className="mono mt-3 text-graphite">Nothing saved yet</p> : null}
      <input ref={file} type="file" accept="image/*" className="hidden" onChange={onFile} data-testid="inspiration-file" />

      <Sheet open={open !== null} onClose={() => setOpen(null)} title="What it read">
        {open ? (
          <div className="flex flex-col gap-3" data-testid="inspiration-sheet">
            <div className="h-[220px] overflow-hidden bg-bone"><img src={`/api/photo/${open.key}`} alt="" className="size-full object-cover" /></div>
            <p className="serif text-[21px] italic leading-[1.3]">{open.notes.summary}</p>
            <Row k="Words" v={open.notes.words.join(", ")} />
            <Row k="Shapes" v={open.notes.silhouettes.join("; ")} />
            <Row k="Colors" v={open.notes.colorPairs.join("; ")} />
            <Row k="Formality" v={open.notes.formality} />
            <Row k="Pieces" v={open.notes.pieces.join(", ")} />
            {canEdit ? <Button variant="secondary" className="mt-2 w-full" disabled={busy !== null} onClick={() => remove(open.id)} data-testid="remove-inspiration">{busy === "remove" ? "Removing…" : "Remove this look"}</Button> : null}
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-h-[42px] items-center gap-3 border-b border-line py-2">
      <span className="mono w-[120px] shrink-0 text-graphite">{k}</span>
      <span className="text-[14px] leading-snug">{v || "—"}</span>
    </div>
  );
}

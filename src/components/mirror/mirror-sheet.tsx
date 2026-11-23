"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Banner } from "@/components/ui/banner";
import { shrinkPhoto } from "@/lib/import/client-queue";
import { addBodyPhotoAction } from "@/app/(app)/profile/actions";
import type { TryOnState, TryOnView } from "@/lib/tryon";
import { ENGINE_WORD } from "@/lib/tryon/engines";
import { shoesPlaceable, slotOf, SLOT_WORD, type Slot } from "@/lib/tryon/complete";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Mirror } from "./use-mirror";

/**
 * "In the mirror": the look on the person's own body photo (theirs alone) or on the shared mannequin,
 * with the view row (on me, from behind, mannequin), the styling chips (pose, tuck, buttons…), "Dress
 * again", and the body photo right there (Jeff, 19 Oct 2026: the mirror must never send him away to
 * fix something it needs). Shared by Today, the closet's pick mode and a piece's page.
 */
/** The line under the panel's button: what the mirror is about to dress. */
function completeSub(m: Mirror): string {
  const p = m.pending!;
  const picks = p.ask.map((s) => p.picks[s]).filter((id): id is string => Boolean(id));
  return m.piecesOf([...p.itemIds, ...picks]).map((x) => x.name).join(" · ");
}

/** "Google, FASHN and Kling" for the line under a comparison. */
const engineList = (v: TryOnView) => [v, ...(v.alts ?? [])].map((p) => ENGINE_WORD[p.engine ?? "google"]).join(", ").replace(/, ([^,]*)$/, " and $1");

type MirrorProps = {
  m: Mirror;
  /** The pieces in the look, for the line under the picture ("White tee · Dark jeans"). */
  pieces: string;
  /** The person in the mirror is the one signed in (a parent dressing a minor's mannequin is not). */
  mine: boolean;
  personId: string;
  personName: string;
  tryOnState: TryOnState;
  backPhoto: boolean;
  /** The current front photo is locked "only me": a retake keeps that lock. */
  bodyOnlyMe?: boolean;
  mannequinAvailable: boolean;
  /** Engine names and notes show for admins only. */
  admin?: boolean;
};

/** The mirror in its sheet, over the screen that started the dressing. The same body fills the full-screen /mirror page. */
export function MirrorSheet(props: MirrorProps) {
  const { m } = props;
  return (
    <Sheet open={m.open} onClose={() => m.setOpen(false)} title={m.pending ? "Complete the look" : "In the mirror"}
      footer={m.pending ? <Button size="lg" className="w-full" sub={completeSub(m)} onClick={m.confirm} data-testid="complete-go">{m.pending.on === "me" ? "See it on me" : "See it on a mannequin"}</Button> : undefined}>
      <MirrorBody {...props} />
    </Sheet>
  );
}

/**
 * What the mirror shows: the picture (or progress), the pieces, the view row, the body photo row, the styling chips and
 * what goes with it. `inline` is the full-screen page: the picture is taller and the complete-the-look button sits at the
 * bottom of the body instead of a sheet footer.
 */
export function MirrorBody({ m, pieces, mine, personId, personName, tryOnState, backPhoto, bodyOnlyMe = false, mannequinAvailable, admin = false, inline = false }: MirrorProps & { inline?: boolean }) {
  const router = useRouter();
  const t = m.tryOn;
  const [secs, setSecs] = useState(0);
  const startedAt = m.progress?.startedAt ?? null;
  useEffect(() => {
    if (startedAt === null) return;
    setSecs(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    const id = setInterval(() => setSecs(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  // The screen knows the pieces' names: the bar under the header shows them while the person is elsewhere.
  const describe = m.describe;
  useEffect(() => { if (pieces) describe(pieces); }, [describe, pieces]);

  // The body photo, taken again (or added) without leaving the mirror; the look is then dressed on it.
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file || !m.look) return;
    setSaving(true); m.setError(undefined);
    try {
      const blob = await shrinkPhoto(file);
      const signRes = await fetch("/api/uploads/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: blob.type || "image/jpeg", kind: "bodies", ownerId: personId }) });
      const signed = (await signRes.json()) as { key: string; url: string; headers: Record<string, string>; error?: string };
      if (!signRes.ok) throw new Error(signed.error || "Upload failed.");
      const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: blob, signal: AbortSignal.timeout(60_000) });
      if (!put.ok) throw new Error("Upload failed.");
      const view = m.on === "me" ? m.view : "front";
      const r = await addBodyPhotoAction(personId, signed.key, bodyOnlyMe, view); // the new photo keeps the old one's privacy lock
      if (!r.ok) throw new Error(r.error);
      router.refresh();
      void m.dress({ look: m.look, on: "me", view, pieces });
    } catch (err) { m.setError((err as Error).message); } finally { setSaving(false); }
  }

  const onMe = Boolean(t) && !t?.mannequin;
  const views = tryOnState === "ready" && (mannequinAvailable || backPhoto)
    ? ([["front", "On me"], ...(backPhoto ? [["back", "From behind"]] : []), ...(mannequinAvailable ? [["mannequin", "Mannequin"]] : [])] as [string, string][])
    : [];
  const photoRow = mine && (tryOnState === "ready" ? (onMe || !t) : tryOnState === "no_photo");
  // The pieces in the picture, by name when the wardrobe knows them (a swap under the picture changes them); else the screen's line.
  const known = t ? m.piecesOf(t.itemIds) : [];
  const line = t && known.length && known.length === t.itemIds.length ? known.map((k) => k.name).join(" · ") : pieces;
  const frame = inline ? "relative w-full overflow-hidden rounded-2xl bg-bone aspect-[3/4] max-h-[72dvh]" : "relative h-[460px] overflow-hidden rounded-2xl bg-bone";
  const all = t ? [t, ...(t.alts ?? [])] : [];

  return (
    <div className="flex flex-col gap-3" data-testid={inline ? "mirror-screen" : undefined}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} data-testid="mirror-body-photo" />
      {m.error ? (
        <div className="flex flex-col gap-2">
          <Banner tone="danger" title={m.error} />
          {!m.busy && m.look ? <button type="button" onClick={() => void m.dress({ look: m.look!, on: m.on, view: m.view, pieces })} className="pill self-start" data-testid="mirror-retry">Try again</button> : null}
        </div>
      ) : null}
      {m.pending ? (
        <>
          <CompletePanel m={m} />
          {inline ? <Button size="lg" className="w-full" sub={completeSub(m)} onClick={m.confirm} data-testid="complete-go">{m.pending.on === "me" ? "See it on me" : "See it on a mannequin"}</Button> : null}
        </>
      ) : t || m.busy ? (
        <div className="flex flex-col gap-3" {...(t ? { "data-testid": "try-on-sheet" } : {})}>
          <div className={frame}>
            {t?.alts?.length ? (
              // Compare: every engine's picture side by side; three or more scroll sideways so each stays big enough to judge.
              <div className={all.length >= 3 ? "strip h-full snap-x snap-mandatory gap-2" : "grid h-full grid-cols-2 gap-1"} data-testid="mirror-compare">
                {all.map((p, i) => (
                  <figure key={p.key} className={cn("flex h-full flex-col", all.length >= 3 && "w-[72%] shrink-0 snap-center")}>
                    <figcaption className="caption px-2 pt-2">{admin ? ENGINE_WORD[p.engine ?? "google"] : `Option ${i + 1}`}</figcaption>
                    <img src={`/api/photo/${p.key}`} alt={admin ? `You wearing this look, by ${ENGINE_WORD[p.engine ?? "google"]}` : "You wearing this look"} className={cn("min-h-0 flex-1 object-contain", m.busy && "opacity-40")} />
                    {/* G1: anyone keeps the column they like; the mirror shows it alone from then on. */}
                    {mine ? <button type="button" disabled={m.busy} onClick={() => void m.keep(p.id)} className="pill pill-sm mx-2 mb-2 mt-1.5" data-testid="mirror-keep">Keep this one</button> : null}
                  </figure>
                ))}
              </div>
            ) : t ? <img key={t.key} src={`/api/photo/${t.key}`} alt={t.mannequin ? "This look on a mannequin" : "You wearing this look"} className={cn("size-full object-contain", m.busy && "opacity-40")} /> : <div className="mx-auto h-full w-[200px] py-10 opacity-60"><MirrorGlyph /></div>}
            {t?.redrawn && !m.busy ? <span className="absolute left-2 top-2 rounded-full bg-paper/95 px-2.5 py-1 text-[12px] font-medium text-ink" data-testid="mirror-redrawn">Redrawn by the image model</span> : null}
            {m.busy && m.progress ? (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-paper/95 px-3 py-2.5" data-testid="mirror-progress" aria-live="polite">
                <span className="mono truncate">{m.progress.step}</span>
                <span className="mono shrink-0 text-graphite" aria-hidden>{secs}s</span>
              </div>
            ) : null}
          </div>
          {m.busy ? <p className="note">Usually about a minute. You can keep using the app: the bar under the header says when it’s ready.</p> : null}
          <p className="mono text-graphite" data-testid="mirror-pieces">{line}</p>
          {t?.styling?.summary ? <p className="mono text-ink" data-testid="styling-summary">{t.styling.summary}{t.stylingFailed ? " · didn’t take this time, showing the plain try-on" : ""}</p> : null}
          {t ? <p className="mono text-ink">{t.mannequin ? `On a mannequin · No body photo used${mine ? "" : ` · ${personName}’s look`}` : t.alts?.length ? `On you${t.view === "back" ? " · from behind" : ""} · ${admin ? `${engineList(t)} side by side · pick the winner under Admin → Rules` : "side by side"} · Only you can see these pictures` : `On you${t.view === "back" ? " · from behind" : ""}${t.kept ? " · your pick" : ""}${admin && t.engine && t.engine !== "google" ? ` · dressed by ${ENGINE_WORD[t.engine]}` : ""} · Only you can see this picture`}{t.cached ? " · saved from before" : ""}</p> : null}
          {t?.note ? <p className="mono text-graphite" data-testid="mirror-note">{t.alts?.length && admin ? `${ENGINE_WORD[t.engine ?? "google"]} · ` : ""}{t.note}</p> : null}
          {t?.alts?.filter((a) => a.note).map((a) => <p key={a.id} className="mono text-graphite" data-testid="mirror-alt-note">{admin ? `${ENGINE_WORD[a.engine ?? "fashn"]} · ` : ""}{a.note}</p>)}
          {t?.engineNote && admin ? <p className="mono text-graphite" data-testid="mirror-engine-note">{t.engineNote}</p> : null}
          {t ? (
            <div className="flex items-center justify-between gap-3">
              <button type="button" disabled={m.busy} onClick={m.redo} className="pill pill-sm shrink-0" data-testid="redo-tryon" title="Throw away the saved pictures of this look and dress it from scratch">{m.busy ? "Dressing…" : "Dress again"}</button>
              <span className="note">{t.kept ? "Not right? Dress again compares the engines afresh." : "Not right? Dress it from scratch."}</span>
            </div>
          ) : null}
          {views.length ? (
            <div className="flex flex-wrap gap-1.5" data-testid="mirror-views">
              {views.map(([v, word]) => {
                const current = v === "mannequin" ? m.on === "mannequin" : m.on === "me" && m.view === v;
                return (
                  <button key={v} type="button" disabled={m.busy} aria-pressed={current} onClick={() => { if (!current) m.switchTo(v as "front" | "back" | "mannequin"); }} className={cn("pill pill-sm", current && "pill-solid")} data-testid={`mirror-view-${v}`}>{word}</button>
                );
              })}
            </div>
          ) : null}
          {/* The body photo, right here: a plain fitted t-shirt and pants, because the model swaps the clothes it can see (swimwear gave it nothing to swap). */}
          {photoRow ? (
            <div className="flex items-center justify-between gap-3 border-t border-line pt-3" data-testid="mirror-photo-row">
              <span className="note">{tryOnState === "ready" ? "Your body photo. A plain fitted t-shirt and pants work best." : "See it on you: add a full-body photo in a plain fitted t-shirt and pants."}</span>
              <button type="button" disabled={m.busy || saving} onClick={() => fileRef.current?.click()} className="pill pill-sm shrink-0" data-testid="retake-body-photo">{saving ? "Saving…" : tryOnState === "ready" ? "Retake" : "Add photo"}</button>
            </div>
          ) : null}
          {/* How it shows: pose, tuck, buttons… a tap re-styles the dressed picture with a second pass by the image model; a plain dressing has none. Lists live under Admin → Lists. */}
          {t?.styling && (t.styling.poses.length > 1 || t.styling.groups.length) ? (
            <div className="flex flex-col gap-3 border-t border-line pt-3" data-testid="mirror-styling">
              <p className="caption">Restyle: tap how it should show. Each tap is a second pass by the image model, so the picture may change a little.</p>
              {[...(t.styling.poses.length > 1 ? [{ id: "pose", name: "Pose", chosen: t.styling.poseId ?? "", explicit: t.styling.poseExplicit, options: t.styling.poses }] : []), ...t.styling.groups].map((g) => (
                <div key={g.id} className="flex flex-col gap-1.5" data-testid={`style-group-${g.id === "pose" ? "pose" : g.name.toLowerCase().replace(/\s+/g, "-")}`}>
                  <span className="mono text-graphite">{g.name}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {g.options.map((o) => {
                      const current = o.id === g.chosen && g.explicit;
                      return (
                        <button key={o.id} type="button" disabled={m.busy} aria-pressed={current} onClick={() => { if (!current) m.restyle(g.id === "pose" ? { poseId: o.id } : { options: { [g.id]: o.id } }); }} className={cn("pill pill-sm", current && "pill-solid")} data-testid="style-option">{o.name}</button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {t && !m.busy ? <GoWithRows m={m} /> : null}
          {!inline && (t || m.busy) ? <Link href="/mirror" onClick={() => m.setOpen(false)} className="pill pill-quiet self-start" data-testid="mirror-full-screen">Open the full mirror</Link> : null}
        </div>
      ) : null}
    </div>
  );
}

const TAG = "mono absolute left-1 top-1 bg-ink px-1 py-0.5 text-[11px] text-paper";

/**
 * Before the mirror dresses a piece from the closet (Jeff, 24 Oct 2026): what would complete the look, every slot on one
 * panel (Jeff, 20 Nov 2026: one question at a time read as "it only asked about bottoms"). A bottom for a top, a top for
 * a bottom, shoes when the picture can show them; the closet's pieces for each slot as thumbnails, the Shop's suggestions
 * first; every row optional. The one button at the bottom dresses it.
 */
function CompletePanel({ m }: { m: Mirror }) {
  const p = m.pending!;
  const chosen = m.piecesOf(p.itemIds);
  const shoesLeftOut = !shoesPlaceable(p.on, m.engine) && m.wardrobe.pieces.some((x) => slotOf(x.category) === "shoes");
  return (
    <div className="flex flex-col gap-5" data-testid="complete-look">
      <div className="flex items-center gap-3">
        <span className="flex shrink-0 gap-1">
          {chosen.slice(0, 3).map((c) => <span key={c.id} className="block h-[64px] w-[48px] overflow-hidden bg-bone">{c.thumbKey ? <img src={`/api/photo/${c.thumbKey}`} alt="" className="size-full object-cover" /> : null}</span>)}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="mono text-graphite">Starting with</span>
          <span className="text-[15px] leading-snug" data-testid="complete-chosen">{chosen.map((c) => c.name).join(" · ")}</span>
        </span>
      </div>
      <p className="note text-ink">Tap what goes with it. Every row is optional: leave it empty and the mirror dresses what you picked.</p>
      {p.ask.map((slot) => {
        const options = m.options(slot, p.itemIds);
        const pickedId = p.picks[slot] ?? null;
        const picked = pickedId ? m.piecesOf([pickedId])[0] : null;
        return (
          <div key={slot} data-testid={`complete-slot-${slot}`}>
            <div className="flex items-baseline justify-between gap-3 border-b border-ink pb-1.5">
              <span className="mono text-ink">{SLOT_WORD[slot].label}</span>
              <span className={cn("mono truncate", picked ? "text-ink" : "text-graphite")} data-testid={`complete-picked-${slot}`}>{picked ? `✓ ${picked.name}` : SLOT_WORD[slot].none}</span>
            </div>
            <div className="-mx-5 mt-2.5 flex gap-2.5 overflow-x-auto px-5 pb-1">
              {options.map((o) => {
                const on = o.id === pickedId;
                return (
                  <button key={o.id} type="button" aria-pressed={on} onClick={() => m.pick(slot, o)} className={cn("w-[96px] shrink-0 text-left", on && "outline outline-2 -outline-offset-2 outline-ink")} data-testid="complete-option" aria-label={o.name}>
                    <span className="relative block h-[128px] overflow-hidden bg-bone">
                      {o.thumbKey ? <img src={`/api/photo/${o.thumbKey}`} alt="" className="size-full object-cover" /> : null}
                      {o.suggested ? <span className={TAG}>Goes with</span> : o.isFavorite ? <span className={TAG}>Favorite</span> : null}
                      {on ? <span className="mono absolute bottom-1 right-1 flex size-6 items-center justify-center bg-ink text-paper" aria-hidden>✓</span> : null}
                    </span>
                    <span className="mt-1 block truncate text-[12px] font-medium">{o.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {shoesLeftOut ? <p className="note" data-testid="complete-shoes-note">Shoes can’t go in this picture yet. The mannequin can show them.</p> : null}
    </div>
  );
}

/**
 * Under the picture (Jeff, 24 Oct 2026: "go to the bottom of the page and decide or observe suggested shoes, other
 * shirts or tops or bottoms to go with the outfit"): the closet's shoes, other tops and other bottoms, the Shop's
 * suggestions first; a tap swaps the piece in and the mirror dresses the look again.
 */
function GoWithRows({ m }: { m: Mirror }) {
  const t = m.tryOn;
  if (!t || !m.wardrobe.pieces.length) return null;
  const ids = t.itemIds;
  const chosen = m.piecesOf(ids);
  if (chosen.length !== ids.length) return null; // a look the wardrobe doesn't know (a shop candidate)
  const slots = new Set(chosen.map((c) => slotOf(c.category)));
  const canShoes = shoesPlaceable(m.on, m.engine);
  const rows: { slot: Slot; title: string }[] = [];
  if (canShoes) rows.push({ slot: "shoes", title: slots.has("shoes") ? "Other shoes" : "Add shoes" });
  if (!slots.has("onePiece")) {
    rows.push({ slot: "top", title: slots.has("top") ? "Other tops" : "Add a top" });
    rows.push({ slot: "bottom", title: slots.has("bottom") ? "Other bottoms" : "Add a bottom" });
  }
  const filled = rows.map((r) => ({ ...r, options: m.options(r.slot, ids).slice(0, 12) })).filter((r) => r.options.length);
  if (!filled.length) return null;
  return (
    <div className="flex flex-col gap-4 border-t border-line pt-3" data-testid="mirror-go-with">
      <p className="note">To go with it: tap a piece and the mirror dresses it again.</p>
      {filled.map((r) => (
        <div key={r.slot} data-testid={`mirror-row-${r.slot}`}>
          <p className="mono text-ink">{r.title}</p>
          <div className="-mx-5 mt-1.5 flex gap-2.5 overflow-x-auto px-5 pb-1">
            {r.options.map((o) => (
              <button key={o.id} type="button" disabled={m.busy} onClick={() => m.swap(o)} className="w-[84px] shrink-0 text-left" data-testid="mirror-swap" aria-label={o.name}>
                <span className="relative block h-[112px] overflow-hidden bg-bone">
                  {o.thumbKey ? <img src={`/api/photo/${o.thumbKey}`} alt="" className="size-full object-cover" /> : null}
                  {o.suggested ? <span className={TAG}>Goes with</span> : o.isFavorite ? <span className={TAG}>Favorite</span> : null}
                </span>
                <span className="mt-1 block truncate text-[12px]">{o.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <Link href={`/closet/${ids[0]}/go-with`} className="pill pill-sm self-start" data-testid="mirror-shop-go-with">Shop for something to go with it</Link>
    </div>
  );
}

/** A simple mirror: an arched frame with a glint, for the empty mirror before the first look. */
export function MirrorGlyph() {
  return (
    <svg viewBox="0 0 100 150" className="size-full" aria-hidden>
      <path d="M22 140 C22 60 30 22 50 22 C70 22 78 60 78 140" fill="none" stroke="#1A1A1A" strokeWidth="1.5" />
      <path d="M36 60 L52 40" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="round" />
      <path d="M40 76 L62 50" stroke="#1A1A1A" strokeWidth="1.2" strokeLinecap="round" />
      <text x="50" y="128" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="9" fill="#1A1A1A" letterSpacing="1.5">YOU</text>
    </svg>
  );
}

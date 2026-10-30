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
import type { Mirror } from "./use-mirror";

/**
 * "In the mirror": the look on the person's own body photo (theirs alone) or on the shared mannequin,
 * with the view row (on me, from behind, mannequin), the styling chips (pose, tuck, buttons…), "Dress
 * again", and the body photo right there (Jeff, 19 Oct 2026: the mirror must never send him away to
 * fix something it needs). Shared by Today, the closet's pick mode and a piece's page.
 */
/** "Google, FASHN and Kling" for the line under a comparison. */
const engineList = (v: TryOnView) => [v, ...(v.alts ?? [])].map((p) => ENGINE_WORD[p.engine ?? "google"]).join(", ").replace(/, ([^,]*)$/, " and $1");

export function MirrorSheet({ m, pieces, mine, personId, personName, tryOnState, backPhoto, mannequinAvailable , admin = false }: { /** Engine names and notes show for admins only. */ admin?: boolean;
  m: Mirror;
  /** The pieces in the look, for the line under the picture ("White tee · Dark jeans"). */
  pieces: string;
  /** The person in the mirror is the one signed in (a parent dressing a minor's mannequin is not). */
  mine: boolean;
  personId: string;
  personName: string;
  tryOnState: TryOnState;
  backPhoto: boolean;
  mannequinAvailable: boolean;
}) {
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
      const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: blob });
      if (!put.ok) throw new Error("Upload failed.");
      const view = m.on === "me" ? m.view : "front";
      const r = await addBodyPhotoAction(personId, signed.key, false, view);
      if (!r.ok) throw new Error(r.error);
      router.refresh();
      void m.dress({ look: m.look, on: "me", view });
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

  return (
    <Sheet open={m.open} onClose={() => m.setOpen(false)} title={m.pending ? "Complete the look" : "In the mirror"}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} data-testid="mirror-body-photo" />
      {m.error ? (
        <div className="mb-3 flex flex-col gap-2">
          <Banner tone="danger" title={m.error} />
          {!m.busy && m.look ? <button type="button" onClick={() => void m.dress({ look: m.look!, on: m.on, view: m.view })} className="pill self-start" data-testid="mirror-retry">Try again</button> : null}
        </div>
      ) : null}
      {m.pending ? <CompletePanel m={m} /> : t || m.busy ? (
        <div className="flex flex-col gap-3" {...(t ? { "data-testid": "try-on-sheet" } : {})}>
          <div className="relative h-[460px] overflow-hidden bg-bone">
            {t?.alts?.length ? (
              <div className={`grid h-full gap-1 ${t.alts.length >= 2 ? "grid-cols-3" : "grid-cols-2"}`} data-testid="mirror-compare">
                {[t, ...t.alts].map((p) => (
                  <figure key={p.id} className="flex h-full flex-col">
                    <figcaption className="mono px-2 pt-2 text-[11px] uppercase tracking-[0.18em]">{admin ? ENGINE_WORD[p.engine ?? "google"] : `Option ${[t, ...(t.alts ?? [])].indexOf(p) + 1}`}</figcaption>
                    <img src={`/api/photo/${p.key}`} alt={admin ? `You wearing this look, by ${ENGINE_WORD[p.engine ?? "google"]}` : "You wearing this look"} className={`min-h-0 flex-1 object-contain ${m.busy ? "opacity-40" : ""}`} />
                  </figure>
                ))}
              </div>
            ) : t ? <img src={`/api/photo/${t.key}`} alt={t.mannequin ? "This look on a mannequin" : "You wearing this look"} className={`size-full object-contain ${m.busy ? "opacity-40" : ""}`} /> : <div className="mx-auto h-full w-[200px] py-10"><MirrorGlyph /></div>}
            {m.busy && m.progress ? (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-paper/95 px-3 py-2.5" data-testid="mirror-progress" aria-live="polite">
                <span className="mono text-[11px] uppercase tracking-[0.18em]">{m.progress.step}</span>
                <span className="mono shrink-0 text-graphite" aria-hidden>{secs}s</span>
              </div>
            ) : null}
          </div>
          {m.busy ? <p className="mono text-graphite">Usually 20 to 60 seconds. You can leave this screen; the picture is kept and waits for you.</p> : null}
          <p className="mono text-graphite" data-testid="mirror-pieces">{line}</p>
          {t?.styling?.summary ? <p className="mono text-ink" data-testid="styling-summary">{t.styling.summary}{t.stylingFailed ? " · didn’t take this time, showing the plain try-on" : ""}</p> : null}
          {t ? <p className="mono text-ink">{t.mannequin ? `On a mannequin · No body photo used${mine ? "" : ` · ${personName}’s look`}` : t.alts?.length ? `On you${t.view === "back" ? " · from behind" : ""} · ${admin ? `${engineList(t)} side by side · pick the winner under Admin → Rules` : "side by side"} · Only you can see these pictures` : `On you${t.view === "back" ? " · from behind" : ""}${admin && t.engine && t.engine !== "google" ? ` · dressed by ${ENGINE_WORD[t.engine]}` : ""} · Only you can see this picture`}{t.cached ? " · saved from before" : ""}</p> : null}
          {t?.note ? <p className="mono text-graphite" data-testid="mirror-note">{t.alts?.length && admin ? `${ENGINE_WORD[t.engine ?? "google"]} · ` : ""}{t.note}</p> : null}
          {t?.alts?.filter((a) => a.note).map((a) => <p key={a.id} className="mono text-graphite" data-testid="mirror-alt-note">{admin ? `${ENGINE_WORD[a.engine ?? "fashn"]} · ` : ""}{a.note}</p>)}
          {t?.engineNote && admin ? <p className="mono text-graphite" data-testid="mirror-engine-note">{t.engineNote}</p> : null}
          {t ? (
            <div className="flex items-center justify-between gap-3">
              <button type="button" disabled={m.busy} onClick={m.redo} className="pill pill-sm shrink-0" data-testid="redo-tryon" title="Throw away the saved pictures of this look and dress it from scratch">{m.busy ? "Dressing…" : "Dress again"}</button>
              <span className="mono text-graphite">Not right? Dress it from scratch</span>
            </div>
          ) : null}
          {views.length ? (
            <div className="flex flex-wrap gap-1.5" data-testid="mirror-views">
              {views.map(([v, word]) => {
                const current = v === "mannequin" ? m.on === "mannequin" : m.on === "me" && m.view === v;
                return (
                  <button key={v} type="button" disabled={m.busy} aria-pressed={current} onClick={() => { if (!current) m.switchTo(v as "front" | "back" | "mannequin"); }} className={`pill pill-sm ${current ? "pill-solid" : ""}`} data-testid={`mirror-${v}`}>{word}</button>
                );
              })}
            </div>
          ) : null}
          {/* The body photo, right here: a plain fitted t-shirt and pants, because the model swaps the clothes it can see (swimwear gave it nothing to swap). */}
          {photoRow ? (
            <div className="flex items-center justify-between gap-3 border-t border-line pt-3" data-testid="mirror-photo-row">
              <span className="mono text-graphite">{tryOnState === "ready" ? "Your body photo · a plain fitted t-shirt and pants work best" : "See it on you · add a full-body photo in a plain fitted t-shirt and pants"}</span>
              <button type="button" disabled={m.busy || saving} onClick={() => fileRef.current?.click()} className="pill pill-sm shrink-0" data-testid="retake-body-photo">{saving ? "Saving…" : tryOnState === "ready" ? "Retake" : "Add photo"}</button>
            </div>
          ) : null}
          {/* How it shows: pose, tuck, buttons… one tap re-styles the same dressed picture (no second dressing). Lists live under Admin → Lists. */}
          {t?.styling && (t.styling.poses.length > 1 || t.styling.groups.length) ? (
            <div className="flex flex-col gap-3 border-t border-line pt-3" data-testid="mirror-styling">
              {[...(t.styling.poses.length > 1 ? [{ id: "pose", name: "Pose", chosen: t.styling.poseId ?? "", options: t.styling.poses }] : []), ...t.styling.groups].map((g) => (
                <div key={g.id} className="flex flex-col gap-1.5" data-testid={`style-group-${g.id === "pose" ? "pose" : g.name.toLowerCase().replace(/\s+/g, "-")}`}>
                  <span className="mono text-graphite">{g.name}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {g.options.map((o) => {
                      const current = o.id === g.chosen;
                      return (
                        <button key={o.id} type="button" disabled={m.busy} aria-pressed={current} onClick={() => { if (!current) m.restyle(g.id === "pose" ? { poseId: o.id } : { options: { [g.id]: o.id } }); }} className={`mono mono-11 h-9 px-3 ${current ? "bg-ink text-paper" : "border border-ink"}`} data-testid={`style-${o.id}`}>{o.name}</button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {t && !m.busy ? <GoWithRows m={m} /> : null}
        </div>
      ) : null}
    </Sheet>
  );
}

const TAG = "mono absolute left-1 top-1 bg-ink px-1 py-0.5 text-[10px] text-paper";

/**
 * Before the mirror dresses a piece from the closet (Jeff, 24 Oct 2026): "Add a bottom?" for a top, "Add a top?" for a
 * bottom, "Add shoes?" when the picture can show them; the closet's pieces for that slot as thumbnails, the Shop's
 * suggestions first, and a way to go without. The last answer dresses the look.
 */
function CompletePanel({ m }: { m: Mirror }) {
  const p = m.pending!;
  const chosen = m.piecesOf(p.itemIds);
  const slot = p.ask[0];
  const options = m.options(slot, p.itemIds);
  const next = p.ask.slice(1);
  const shoesLeftOut = !shoesPlaceable(p.on, m.engine) && m.wardrobe.pieces.some((x) => slotOf(x.category) === "shoes");
  return (
    <div className="flex flex-col gap-3" data-testid="complete-look">
      <p className="mono text-graphite" data-testid="complete-chosen">{chosen.map((c) => c.name).join(" · ")}</p>
      <p className="serif text-[28px] leading-none" data-testid="complete-ask">{SLOT_WORD[slot].ask}</p>
      <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pb-1">
        {options.map((o) => (
          <button key={o.id} type="button" onClick={() => m.choose(o)} className="w-[96px] shrink-0 text-left" data-testid="complete-option" aria-label={o.name}>
            <span className="relative block h-[128px] overflow-hidden bg-bone">
              {o.thumbKey ? <img src={`/api/photo/${o.thumbKey}`} alt="" className="size-full object-cover" /> : null}
              {o.suggested ? <span className={TAG}>Goes with it</span> : o.isFavorite ? <span className={TAG}>Favorite</span> : null}
            </span>
            <span className="mt-1 block truncate text-[12px] font-medium">{o.name}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => m.choose(null)} className="pill pill-sm shrink-0" data-testid="complete-skip">{SLOT_WORD[slot].skip(chosen)}</button>
        <span className="mono text-right text-graphite">{next.length ? `Then: ${next.map((s) => (s === "shoes" ? "shoes" : `a ${s}`)).join(", ")}` : p.on === "me" ? "Then the mirror dresses you" : "Then the mannequin wears it"}</span>
      </div>
      {shoesLeftOut ? <p className="mono text-graphite" data-testid="complete-shoes-note">Shoes can’t go in this picture yet. The mannequin can show them.</p> : null}
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
      <p className="mono text-graphite">To go with it · tap a piece and the mirror dresses it again</p>
      {filled.map((r) => (
        <div key={r.slot} data-testid={`mirror-row-${r.slot}`}>
          <p className="mono text-ink">{r.title}</p>
          <div className="-mx-5 mt-1.5 flex gap-2.5 overflow-x-auto px-5 pb-1">
            {r.options.map((o) => (
              <button key={o.id} type="button" disabled={m.busy} onClick={() => m.swap(o)} className="w-[84px] shrink-0 text-left" data-testid="mirror-swap" aria-label={o.name}>
                <span className="relative block h-[112px] overflow-hidden bg-bone">
                  {o.thumbKey ? <img src={`/api/photo/${o.thumbKey}`} alt="" className="size-full object-cover" /> : null}
                  {o.suggested ? <span className={TAG}>Goes with it</span> : o.isFavorite ? <span className={TAG}>Favorite</span> : null}
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

"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Sheet } from "@/components/ui/sheet";
import { TextSheet } from "@/components/items/row-editor";
import { shrinkPhoto } from "@/lib/import/client-queue";
import { cn } from "@/lib/cn";
import type { LookupView } from "@/lib/shop/engine";
import { deleteLookupAction, lookupLinkAction, lookupPhotoAction, tryOnLookupAction } from "./actions";
import type { TryOnState, TryOnView } from "@/lib/tryon";

const CALL_WORD = { FITS: "Fits · buy it", RISKY: "Risky · maybe", PASS: "Pass · skip it" } as const;

export function ShopScreen({ meId, people, forPersonId, selected, recent, tryOn, mannequin }: { meId: string; people: { id: string; name: string }[]; forPersonId: string; selected: LookupView | null; recent: LookupView[]; tryOn: TryOnState; /** SEE IT ON dresses the shared mannequin when the person's own try-on is not ready. */ mannequin: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<"link" | "photo" | "delete" | "tryon" | null>(null);
  const [onMe, setOnMe] = useState<TryOnView | null>(null);
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState<"for" | "link" | null>(null);
  const [source, setSource] = useState<"screenshot" | "photo">("screenshot");
  const file = useRef<HTMLInputElement>(null);
  const forName = people.find((p) => p.id === forPersonId)?.name ?? "me";

  function run(kind: "link" | "photo" | "delete", fn: () => Promise<{ ok: boolean; error?: string; id?: string }>) {
    setError(undefined); setBusy(kind);
    start(async () => {
      const r = await fn(); setBusy(null);
      if (!r.ok) setError(r.error); else if (r.id) router.replace(`/shop?for=${forPersonId}&l=${r.id}`);
      router.refresh();
    });
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    const blob = await shrinkPhoto(f, 1600);
    const fd = new FormData(); fd.set("photo", new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" })); fd.set("source", source);
    run("photo", () => lookupPhotoAction(forPersonId, fd));
  }
  const thinking = busy === "link" || busy === "photo";

  return (
    <div data-testid="shop" className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-14">
      <div className="lg:col-span-2">
        <PageHeader
          eyebrow={<button type="button" onClick={() => setSheet("for")} className="mono text-ink" data-testid="shop-for">Shopping for · {forPersonId === meId ? "me" : forName} ⌄</button>}
          title="Should I" accent="buy it?" />
      </div>
      {error ? <Banner tone="danger" title={error} className="mb-3 lg:col-span-2" /> : null}

      <div className="lg:col-start-2 lg:row-start-3">
        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" className="h-[54px] px-2 text-[10px]" disabled={thinking} onClick={() => setSheet("link")} data-testid="paste-link">Paste a link</Button>
          <Button variant="secondary" className="h-[54px] px-2 text-[10px]" disabled={thinking} onClick={() => { setSource("screenshot"); file.current?.removeAttribute("capture"); file.current?.click(); }} data-testid="upload-screenshot">Screenshot</Button>
          <Button variant="secondary" className="h-[54px] px-2 text-[10px]" disabled={thinking} onClick={() => { setSource("photo"); file.current?.setAttribute("capture", "environment"); file.current?.click(); }} data-testid="take-photo">Take a photo</Button>
        </div>
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={onFile} data-testid="shop-file" />
        {thinking ? <p className="mono mt-3 text-graphite" data-testid="shop-thinking">Looking at it…</p> : null}
      </div>

      {selected ? (
        <section className="mt-6 lg:col-start-1 lg:row-start-3 lg:row-span-3 lg:mt-0" data-testid="shop-result">
          <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-4">
            <div className="h-[160px] overflow-hidden bg-bone">{selected.imageKey ? <img src={`/api/photo/${selected.imageKey}`} alt={selected.title ?? ""} className="size-full object-cover" /> : null}</div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="mono text-graphite">{[selected.read.categoryName, selected.brandText, selected.priceText].filter(Boolean).join(" · ") || "New piece"}</p>
              <p className="serif text-[30px] leading-none">{selected.title ?? "New piece"}</p>
              <p className="mono text-graphite">For {selected.forName}{selected.inputUrl ? <> · <a href={selected.inputUrl} target="_blank" rel="noreferrer" className="text-ink">Open link</a></> : null}</p>
            </div>
          </div>
          <div className="mt-4 border-y border-ink py-2.5" data-testid="verdict">
            <p className="mono text-ink">{CALL_WORD[selected.verdict.call]}</p>
            <p className="serif mt-1.5 text-[21px] italic leading-[1.3]">{selected.verdict.reason}</p>
            {selected.verdict.sizeNote ? <p className="mono mt-1.5 text-graphite">{selected.verdict.sizeNote}</p> : null}
            {!selected.verdict.usedBodyData ? <p className="mono mt-1.5 text-graphite">Judged on style and closet only</p> : null}
          </div>
          {selected.imageKey && (tryOn === "ready" || mannequin) ? (
            <div className="mt-3">
              <Button variant="secondary" className="w-full" disabled={busy !== null} onClick={() => { setBusy("tryon"); setError(undefined); start(async () => { const r = await tryOnLookupAction(selected.id); setBusy(null); if (!r.ok) setError(r.error); else if (r.tryOn) setOnMe(r.tryOn); }); }} data-testid={tryOn === "ready" ? "see-it-on-me" : "see-on-mannequin"}>{busy === "tryon" ? (tryOn === "ready" ? "Dressing you…" : "Dressing the mannequin…") : "See it on"}</Button>
              {tryOn === "off" || tryOn === "no_photo" ? <Link href={tryOn === "off" ? "/profile/settings" : "/profile/body"} className="mono flex h-[38px] items-center justify-center text-graphite" data-testid={tryOn === "off" ? "try-on-off" : "try-on-photo"}>{tryOn === "off" ? "Want it on you? Turn on try-on in Settings" : "Want it on you? Add a body photo first"}</Link> : null}
            </div>
          ) : null}
          {selected.similar.length ? (
            <div className="mt-4">
              <p className="mono text-graphite">You already own similar</p>
              <div className="mt-2 flex gap-1.5">
                {selected.similar.map((s) => <Link key={s.id} href={`/closet/${s.id}`} className="h-[84px] w-[64px] overflow-hidden bg-bone" aria-label={s.name}>{s.thumbKey ? <img src={`/api/photo/${s.thumbKey}`} alt="" className="size-full object-cover" /> : null}</Link>)}
              </div>
            </div>
          ) : null}
          {selected.pairings.length ? (
            <div className="mt-6 space-y-6" data-testid="pairings">
              <p className="mono border-b border-ink pb-2 text-graphite">Wear it with</p>
              {selected.pairings.map((b, i) => (
                <div key={i}>
                  <div className="grid grid-cols-4 gap-1.5">
                    {b.pieces.slice(0, 4).map((x) => <div key={x.id} className={cn("h-[112px] overflow-hidden bg-bone", x.id === "candidate" && "outline outline-2 -outline-offset-2 outline-ink")}>{x.thumbKey ? <img src={`/api/photo/${x.thumbKey}`} alt={x.name} className="size-full object-cover" /> : <div className="flex size-full items-end p-1.5"><span className="mono text-graphite">{x.name}</span></div>}</div>)}
                  </div>
                  <p className="mono mt-2 text-graphite">{b.pieces.map((x) => x.label).join(" · ")}</p>
                  <p className="serif mt-1 text-[21px] italic leading-[1.3]">{b.reason}</p>
                </div>
              ))}
            </div>
          ) : <p className="mono mt-6 text-graphite">Nothing in {selected.forName === "me" ? "your" : `${selected.forName}’s`} closet to pair it with yet.</p>}
          {selected.products.length ? (
            <div className="mt-6" data-testid="products">
              <div className="flex items-end justify-between border-b border-ink pb-2">
                <p className="mono text-graphite">{selected.verdict.missingCategory ? `${selected.verdict.missingCategory} to go with it` : "Instead of this"}</p>
                <p className="mono text-graphite">{selected.products.length} from {new Set(selected.products.map((p) => p.storeName)).size} stores</p>
              </div>
              <div className="-mx-5 mt-3 flex snap-x gap-2.5 overflow-x-auto px-5 pb-2 lg:mx-0 lg:px-0" data-testid="product-row">
                {selected.products.map((p) => (
                  <div key={p.url} className="w-[150px] shrink-0 snap-start" data-testid="product">
                    <a href={p.url} target="_blank" rel="noreferrer" className="block h-[190px] overflow-hidden bg-bone" aria-label={p.title}>
                      {p.imageUrl ? <img src={p.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" /> : null}
                    </a>
                    <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug">{p.title}</p>
                    <p className="mono mt-1 text-graphite">{[p.priceText, p.storeName].filter(Boolean).join(" · ")}</p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <a href={p.url} target="_blank" rel="noreferrer" className="mono py-2 text-ink">Buy →</a>
                      <button type="button" disabled={thinking} onClick={() => run("link", () => lookupLinkAction(forPersonId, p.url))} className="mono py-2 text-ink" data-testid="judge-product">Judge it</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {selected.recommendations.length && !selected.products.length ? (
            <div className="mt-6" data-testid="picks">
              <p className="mono border-b border-ink pb-2 text-graphite">You might like</p>
              {selected.recommendations.map((r, i) => (
                <a key={i} href={r.url} target="_blank" rel="noreferrer" className="flex h-[42px] items-center border-b border-line">
                  <span className="mono w-[120px] shrink-0 text-graphite">{r.storeName}</span>
                  <span className="flex-1 truncate text-[14px]">{r.label}</span>
                  <span className="mono text-ink">Buy →</span>
                </a>
              ))}
            </div>
          ) : null}
          {(selected.shopperId === meId || selected.forPersonId === meId) ? <button type="button" disabled={busy === "delete"} onClick={() => run("delete", () => deleteLookupAction(selected.id))} className="mono mt-4 text-graphite" data-testid="remove-lookup">Remove</button> : null}
        </section>
      ) : (
        <section className="mt-6 lg:col-start-1 lg:row-start-3 lg:mt-0" data-testid="shop-empty">
          <div className="h-[260px] bg-bone" />
          <p className="serif mt-3.5 text-[21px] italic leading-[1.3]">Paste a store link, drop a screenshot, or snap a dressing-room photo. You get a verdict, what you already own like it, and three ways to wear it.</p>
        </section>
      )}

      {recent.length > 1 || (recent.length === 1 && recent[0].id !== selected?.id) ? (
        <section className="mt-8 lg:col-start-2 lg:row-start-4">
          <p className="mono border-b border-ink pb-2 text-graphite">Recent</p>
          {recent.map((r) => (
            <Link key={r.id} href={`/shop?for=${forPersonId}&l=${r.id}`} className={cn("flex h-[52px] items-center gap-3 border-b border-line", r.id === selected?.id && "bg-bone")} data-testid="recent-row">
              <span className="size-10 shrink-0 bg-bone">{r.imageKey ? <img src={`/api/photo/${r.imageKey}`} alt="" className="size-full object-cover" /> : null}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[14px]">{r.title ?? "New piece"}</span><span className="mono block text-graphite">{CALL_WORD[r.verdict.call]}{r.priceText ? ` · ${r.priceText}` : ""}</span></span>
            </Link>
          ))}
        </section>
      ) : null}

      <Sheet open={onMe !== null} onClose={() => setOnMe(null)} title={onMe?.mannequin ? "On a mannequin" : "On you"}>
        {onMe ? (
          <div className="flex flex-col gap-3" data-testid="see-it-on-me-sheet">
            <div className="h-[460px] overflow-hidden bg-bone"><img src={`/api/photo/${onMe.key}`} alt={onMe.mannequin ? "This piece on a mannequin" : "You wearing this piece"} className="size-full object-contain" /></div>
            <p className="mono text-graphite">{onMe.mannequin ? "No body photo used" : "Only you can see this picture"}{onMe.cached ? " · saved from before" : ""}</p>
          </div>
        ) : null}
      </Sheet>
      <Sheet open={sheet === "for"} onClose={() => setSheet(null)} title="Shopping for">
        <div className="flex flex-col" role="listbox">
          {people.map((p) => <Link key={p.id} href={`/shop?for=${p.id}`} role="option" aria-selected={p.id === forPersonId} onClick={() => setSheet(null)} className="flex h-12 items-center justify-between border-b border-line text-[15px]"><span>{p.id === meId ? `${p.name} (me)` : p.name}</span><span className={cn("mono", p.id === forPersonId ? "text-ink" : "text-transparent")}>✓</span></Link>)}
        </div>
        <p className="mono mt-4 text-graphite">You can shop for yourself, your kids, and anyone who allowed it in their Settings.</p>
      </Sheet>
      <TextSheet open={sheet === "link"} onClose={() => setSheet(null)} title="Paste a link" label="Store link" value="" placeholder="https://www.everlane.com/products/…" onSave={(v) => run("link", () => lookupLinkAction(forPersonId, v))} />
    </div>
  );
}

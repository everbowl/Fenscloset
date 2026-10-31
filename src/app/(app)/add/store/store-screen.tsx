"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { shrinkPhoto } from "@/lib/import/client-queue";
import type { StoreProduct } from "@/lib/store/add";
import type { MatchedLine, Receipt } from "@/lib/store/receipt";
import type { Product } from "@/lib/shop/products";
import { addFromStoreAction, addReceiptLinesAction, colorPhotosAction, lookupProductAction, readReceiptAction } from "./actions";

type Tab = "link" | "receipt";

/** Add from a store: a product link or a receipt → the store's photo and facts → the normal confirm card. */
export function StoreScreen({ canSearch, initialTab = "link" }: { canSearch: boolean; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div>
      <PageHeader title="Add from" accent="a store" aside={<Link href="/add" className="pill pill-sm">Photos instead</Link>} />
      <div className="mt-2 flex gap-1.5" role="tablist">
        {(["link", "receipt"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`mono mono-11 h-9 px-4 ${tab === t ? "bg-ink text-paper" : "border border-ink"}`} data-testid={`tab-${t}`}>{t === "link" ? "Product link" : "Receipt"}</button>
        ))}
      </div>
      {tab === "link" ? <LinkTab canSearch={canSearch} /> : <ReceiptTab />}
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex h-9 items-center border-b border-ink">
      <button type="button" aria-label="One fewer" onClick={() => onChange(Math.max(1, value - 1))} className="mono size-9 text-[17px]">−</button>
      <span className="mono w-10 text-center text-[17px]" data-testid="quantity">{value}</span>
      <button type="button" aria-label="One more" onClick={() => onChange(Math.min(10, value + 1))} className="mono size-9 text-[17px]">+</button>
    </div>
  );
}

function Pills({ options, value, onPick, testPrefix }: { options: string[]; value: string; onPick: (v: string) => void; testPrefix: string }) {
  if (!options.length) return null;
  return (
    <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] lg:mx-0 lg:px-0">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onPick(o)} aria-pressed={o === value} className={`mono mono-11 h-8 shrink-0 px-3 ${o === value ? "bg-ink text-paper" : "border border-ink"}`} data-testid={`${testPrefix}-${o}`}>{o}</button>
      ))}
    </div>
  );
}

function PhotoPicks({ picks, chosen, onPick }: { picks: Product[]; chosen: string | null; onPick: (url: string) => void }) {
  return (
    <div className="-mx-5 flex snap-x gap-2.5 overflow-x-auto px-5 pb-2 lg:mx-0 lg:px-0" data-testid="photo-picks">
      {picks.map((p) => (
        <button key={p.url} type="button" onClick={() => onPick(p.imageUrl!)} aria-pressed={p.imageUrl === chosen} className={`w-[110px] shrink-0 snap-start text-left ${p.imageUrl === chosen ? "outline outline-2 outline-ink" : ""}`} data-testid="photo-pick">
          <div className="h-[140px] overflow-hidden bg-bone"><img src={p.imageUrl!} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" /></div>
          <p className="mt-1 line-clamp-2 text-[12px] leading-snug">{p.title}</p>
          <p className="mono mt-0.5 text-graphite">{[p.query === "exact" ? "Exact item" : null, p.priceText, p.storeName].filter(Boolean).join(" · ")}</p>
        </button>
      ))}
    </div>
  );
}

function LinkTab({ canSearch }: { canSearch: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [qty, setQty] = useState(1);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [picks, setPicks] = useState<Product[] | null>(null);
  const [error, setError] = useState<string>();
  const [added, setAdded] = useState<number>(0);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"lookup" | "photos" | "add" | null>(null);
  /** Linear (Jeff, 18 Oct 2026): one question at a time. Color is asked only when the store lists colors, size likewise. */
  const [step, setStep] = useState<"color" | "size" | "qty">("color");

  function lookup() {
    setError(undefined); setProduct(null); setPicks(null); setAdded(0); setBusy("lookup");
    start(async () => {
      const r = await lookupProductAction(url);
      setBusy(null);
      if (!r.ok) { setError(r.error); return; }
      setProduct(r.value); setColor(""); setSize(""); setQty(1); setImageUrl(r.value.imageUrl);
      setStep(r.value.colors.length ? "color" : r.value.sizes.length ? "size" : "qty");
    });
  }
  function pickColor(c: string) {
    setColor(c); setPicks(null);
    if (product?.colorImages[c]) setImageUrl(product.colorImages[c]);
    setStep(product?.sizes.length ? "size" : "qty");
  }
  function pickSize(v: string) { setSize(v); setStep("qty"); }
  function again() { setAdded(0); setStep(product?.colors.length ? "color" : product?.sizes.length ? "size" : "qty"); }
  function findPhotos() {
    if (!product || !color.trim()) return;
    setError(undefined); setBusy("photos");
    start(async () => {
      const r = await colorPhotosAction({ name: product.name, brandText: product.brandText }, color.trim());
      setBusy(null);
      if (!r.ok) { setError(r.error); return; }
      setPicks(r.value);
      if (!r.value.length) setError("No photos found for that color. The store's own photo will be used.");
    });
  }
  function add() {
    if (!product) return;
    setError(undefined); setBusy("add");
    start(async () => {
      const r = await addFromStoreAction({ product: { url: product.url, name: product.name, brandText: product.brandText, storeName: product.storeName, priceText: product.priceText }, imageUrl, color: color || null, size: size || null, quantity: qty });
      setBusy(null);
      if (!r.ok) { setError(r.error); return; }
      setAdded((n) => n + r.value.count); setBatchId(r.value.batchId);
      router.refresh();
    });
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      <form onSubmit={(e) => { e.preventDefault(); if (url.trim() && !pending) lookup(); }} className="flex flex-col gap-5">
        <Field label="Product link" htmlFor="store-url" hint="Paste the page of the piece you own. Most stores work; some block it, and then you can pick a photo from a search instead.">
          <Input id="store-url" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://shop.lululemon.com/…" data-testid="store-url" />
        </Field>
        {product ? <button type="submit" className="pill self-start" disabled={pending || !url.trim()} data-testid="lookup">{busy === "lookup" ? "Looking it up…" : "Look up another"}</button>
          : <Button type="submit" size="lg" disabled={pending || !url.trim()} data-testid="lookup">{busy === "lookup" ? "Looking it up…" : "Look it up"}</Button>}
      </form>
      {error ? <Banner tone="danger" title={error} /> : null}

      {product ? (
        <div className="flex flex-col gap-4" data-testid="product-card">
          <div className="h-[300px] bg-bone">{imageUrl ? <img src={imageUrl} alt="" referrerPolicy="no-referrer" className="size-full object-contain" data-testid="product-image" /> : null}</div>
          <div>
            <h2 className="serif text-[26px] leading-tight" data-testid="product-name">{product.name}</h2>
            <p className="mono mt-1 text-graphite">{[product.brandText, product.storeName, product.priceText].filter(Boolean).join(" · ")}</p>
            {product.source === "search" ? <p className="mono mt-2 normal-case text-graphite" data-testid="via-search">{product.storeName} blocked the link, so this came from a product search. Check the photo is your piece; if not, type the color and tap “Find a photo in this color”.</p> : null}
          </div>
          <ol className="mono flex gap-3 text-graphite" aria-label="Steps">
            {([["color", "Color"], ["size", "Size"], ["qty", "How many"]] as const).filter(([k]) => k === "qty" || (k === "color" ? product.colors.length : product.sizes.length)).map(([k, l], i) => <li key={k} className={step === k ? "text-ink" : ""}>{i + 1} {l}</li>)}
          </ol>
          {step === "color" ? (
            <Field label="Which color?" htmlFor="store-color" hint="Tap one, or type it and press Next.">
              <Pills options={product.colors} value={color} onPick={pickColor} testPrefix="color" />
              <div className="flex gap-2"><Input id="store-color" value={color} onChange={(e) => { setColor(e.target.value); setPicks(null); }} placeholder="Black" data-testid="store-color" /><Button type="button" variant="outline" onClick={() => pickColor(color.trim())} disabled={!color.trim()} data-testid="color-next">Next</Button></div>
            </Field>
          ) : null}
          {step !== "color" && color ? <p className="mono" data-testid="chosen-color">Color · {color} <button type="button" onClick={() => setStep("color")} className="ml-2 text-graphite">change</button></p> : null}
          {step !== "color" && canSearch && color.trim() && !product.colorImages[color] && !picks ? <button type="button" onClick={findPhotos} disabled={pending} className="pill self-start" data-testid="find-photos">{busy === "photos" ? "Searching…" : "Find a photo in this color"}</button> : null}
          {picks && picks.length ? <PhotoPicks picks={picks} chosen={imageUrl} onPick={setImageUrl} /> : null}
          {step === "size" ? (
            <Field label="Which size?" htmlFor="store-size" hint="Tap one, type it, or skip.">
              <Pills options={product.sizes} value={size} onPick={pickSize} testPrefix="size" />
              <div className="flex gap-2"><Input id="store-size" value={size} onChange={(e) => setSize(e.target.value)} placeholder="M · 32 · 8" data-testid="store-size" /><Button type="button" variant="outline" onClick={() => pickSize(size.trim())} data-testid="size-next">{size.trim() ? "Next" : "Skip"}</Button></div>
            </Field>
          ) : null}
          {step === "qty" && size ? <p className="mono" data-testid="chosen-size">Size · {size} <button type="button" onClick={() => setStep("size")} className="ml-2 text-graphite">change</button></p> : null}
          {step === "qty" ? (
            <Field label="How many of this one?">
              <Stepper value={qty} onChange={setQty} />
            </Field>
          ) : null}
          {step === "qty" && added === 0 ? <Button size="lg" onClick={add} disabled={pending || !imageUrl} data-testid="add-to-closet">{busy === "add" ? "Adding…" : `Add ${qty > 1 ? `${qty} ` : ""}to closet`}</Button> : null}
          {added > 0 ? (
            <div className="flex items-center justify-between border-y border-ink py-2.5" data-testid="added-strip">
              <span className="mono tracking-[0.1em]">{added} ready to check</span>
              <div className="flex gap-4"><button type="button" onClick={again} className="pill" data-testid="add-another-color">Another color or size</button><Link href={batchId ? `/add/${batchId}` : "/add"} className="pill pill-solid" data-testid="check-it">Check it →</Link></div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type LineState = MatchedLine & { pick: Product | null };

function ReceiptTab() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [lines, setLines] = useState<LineState[]>([]);
  const [openPicks, setOpenPicks] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<"read" | "add" | null>(null);
  const [done, setDone] = useState<{ count: number; skipped: number; batchId: string | null } | null>(null);
  const [pending, start] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(undefined); setReceipt(null); setLines([]); setDone(null); setBusy("read");
    try {
      const blob = await shrinkPhoto(file);
      const signRes = await fetch("/api/uploads/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: blob.type || "image/jpeg", kind: "labels" }) });
      const signed = (await signRes.json()) as { key: string; url: string; headers: Record<string, string>; error?: string };
      if (!signRes.ok) throw new Error(signed.error || "Upload failed.");
      const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: blob });
      if (!put.ok) throw new Error("Upload failed.");
      const r = await readReceiptAction(signed.key);
      if (!r.ok) throw new Error(r.error);
      setReceipt(r.value.receipt);
      setLines(r.value.lines.map((l) => ({ ...l, pick: l.picks[0] ?? null })));
      if (!r.value.lines.length) setError("No clothing lines were found on that receipt.");
    } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  }
  function update(i: number, patch: Partial<LineState>) { setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); }
  function add() {
    if (!receipt) return;
    setError(undefined); setBusy("add");
    start(async () => {
      const r = await addReceiptLinesAction(receipt.storeName ?? "", receipt.orderDate, lines.map((l) => ({ name: l.name, color: l.color, size: l.size, quantity: l.quantity, priceText: l.priceText, pick: l.pick })));
      setBusy(null);
      if (!r.ok) { setError(r.error); return; }
      setDone({ count: r.value.count, skipped: r.value.skipped, batchId: r.value.batchId });
      router.refresh();
    });
  }
  const total = lines.reduce((n, l) => n + (l.pick ? l.quantity : 0), 0);

  return (
    <div className="mt-5 flex flex-col gap-5">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} data-testid="receipt-file" />
      <p className="mono text-graphite">A screenshot of the order email, or a photo of the receipt. It is read once and deleted; only the pieces and prices are kept.</p>
      <Button size="lg" onClick={() => fileRef.current?.click()} disabled={busy === "read"} data-testid="pick-receipt">{busy === "read" ? "Reading the receipt…" : "Upload a receipt"}</Button>
      {error ? <Banner tone="danger" title={error} /> : null}

      {receipt && lines.length ? (
        <div className="flex flex-col" data-testid="receipt-lines">
          <p className="mono text-graphite">{[receipt.storeName, receipt.orderDate].filter(Boolean).join(" · ")}</p>
          {lines.map((l, i) => (
            <div key={i} className="border-b border-line py-3" data-testid="receipt-line">
              <div className="flex gap-3">
                <div className="h-[72px] w-[56px] shrink-0 overflow-hidden bg-bone">{l.pick?.imageUrl ? <img src={l.pick.imageUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" /> : null}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium leading-snug">{l.name}</p>
                  <p className="mono mt-1 text-graphite">{[l.color, l.size, l.quantity > 1 ? `×${l.quantity}` : null, l.priceText, l.pick?.query === "exact" ? "Exact item at the store" : l.pick ? "Closest match" : null].filter(Boolean).join(" · ")}</p>
                  <div className="mt-1.5 flex gap-4">
                    {l.picks.length ? <button type="button" onClick={() => setOpenPicks(openPicks === i ? null : i)} className="pill pill-sm" data-testid="pick-another">{l.pick ? "Pick another" : "Pick a photo"}</button> : <span className="mono text-graphite">No photo found · take one later</span>}
                    {l.pick ? <button type="button" onClick={() => update(i, { pick: null })} className="pill pill-sm pill-quiet">Skip this one</button> : null}
                  </div>
                </div>
              </div>
              {openPicks === i ? <div className="mt-3"><PhotoPicks picks={l.picks} chosen={l.pick?.imageUrl ?? null} onPick={(u) => { update(i, { pick: l.picks.find((p) => p.imageUrl === u) ?? null }); setOpenPicks(null); }} /></div> : null}
            </div>
          ))}
          {done ? (
            <div className="mt-4 flex items-center justify-between border-y border-ink py-2.5" data-testid="added-strip">
              <span className="mono tracking-[0.1em]">{done.count} ready to check{done.skipped ? ` · ${done.skipped} skipped` : ""}</span>
              <Link href={done.batchId ? `/add/${done.batchId}` : "/add"} className="pill pill-solid" data-testid="check-it">Check it →</Link>
            </div>
          ) : (
            <Button size="lg" className="mt-4" onClick={add} disabled={pending || !total} data-testid="add-receipt">{busy === "add" ? "Adding…" : `Add ${total} piece${total === 1 ? "" : "s"}`}</Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

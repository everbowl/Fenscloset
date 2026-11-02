"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { shrinkPhoto } from "@/lib/import/client-queue";
import type { StoreProduct } from "@/lib/store/add";
import type { MatchedLine, Receipt } from "@/lib/store/receipt";
import type { Product } from "@/lib/shop/products";
import { addReceiptsAction, addStoreRowsAction, colorPhotosAction, lookupProductAction, ownedRowsAction, readReceiptAction } from "./actions";

type Tab = "link" | "receipt";

/** Add from a store: a product link (how many in each color and size, or said in words) or receipts, as many as you like → the store's photo and facts → the normal confirm card. */
export function StoreScreen({ canSearch, initialTab = "link" }: { canSearch: boolean; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div>
      <PageHeader title="Add from" accent="a store" aside={<Link href="/add" className="pill pill-sm">Photos instead</Link>} />
      <div className="mt-2 flex gap-1.5" role="tablist">
        {(["link", "receipt"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`mono mono-11 h-9 px-4 ${tab === t ? "bg-ink text-paper" : "border border-ink"}`} data-testid={`tab-${t}`}>{t === "link" ? "Product link" : "Receipts"}</button>
        ))}
      </div>
      {tab === "link" ? <LinkTab canSearch={canSearch} /> : <ReceiptTab />}
    </div>
  );
}

function Stepper({ value, onChange, min = 1, what = "", testId = "quantity" }: { value: number; onChange: (n: number) => void; min?: number; what?: string; testId?: string }) {
  return (
    <div className="flex h-9 shrink-0 items-center border-b border-ink">
      <button type="button" aria-label={`One fewer${what ? ` ${what}` : ""}`} onClick={() => onChange(Math.max(min, value - 1))} className="mono size-9 text-[17px]">−</button>
      <span className={cn("mono w-9 text-center text-[17px]", value === 0 && "text-graphite")} data-testid={testId}>{value}</span>
      <button type="button" aria-label={`One more${what ? ` ${what}` : ""}`} onClick={() => onChange(Math.min(10, value + 1))} className="mono size-9 text-[17px]">+</button>
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

/** One color of the product: how many, its size when it differs from "size for all", and its photo. */
type Row = { color: string | null; size: string | null; quantity: number; imageUrl: string | null; picks: Product[] | null; sizing: boolean };
const sameColor = (a: string | null, b: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
const rowKey = (r: Row) => r.color ?? "any";

function LinkTab({ canSearch }: { canSearch: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [sizeAll, setSizeAll] = useState("");
  const [sizeTyped, setSizeTyped] = useState("");
  const [newColor, setNewColor] = useState("");
  const [words, setWords] = useState("");
  const [error, setError] = useState<string>();
  const [added, setAdded] = useState<number>(0);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"lookup" | "words" | "photos" | "add" | null>(null);

  /** The page's colors, each with its own photo when the page gave one; a page without colors gets one row. */
  const rowsFrom = (p: StoreProduct): Row[] => (p.colors.length ? p.colors : [null]).map((c) => ({ color: c, size: null, quantity: 0, imageUrl: c ? p.colorImages[c] ?? null : p.imageUrl, picks: null, sizing: false }));
  const patch = (i: number, changes: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...changes } : r)));

  function lookup() {
    setError(undefined); setProduct(null); setAdded(0); setBusy("lookup");
    start(async () => {
      const r = await lookupProductAction(url);
      setBusy(null);
      if (!r.ok) { setError(r.error); return; }
      setProduct(r.value); setRows(rowsFrom(r.value)); setSizeAll(""); setSizeTyped(""); setWords(""); setNewColor("");
    });
  }
  function addColor(name: string) {
    const c = name.trim();
    if (!c) return;
    setRows((rs) => {
      const i = rs.findIndex((r) => sameColor(r.color, c));
      return i >= 0 ? rs.map((r, j) => (j === i ? { ...r, quantity: Math.min(10, r.quantity + 1) } : r)) : [...rs, { color: c, size: null, quantity: 1, imageUrl: null, picks: null, sizing: false }];
    });
    setNewColor("");
  }
  /** The note becomes counts on the rows: a color the page knows gets its count, a new color gets a row, one size for all when every row says the same size. */
  function readWords() {
    if (!product || !words.trim()) return;
    setError(undefined); setBusy("words");
    start(async () => {
      const r = await ownedRowsAction({ name: product.name, colors: product.colors, sizes: product.sizes }, words);
      setBusy(null);
      if (!r.ok) { setError(r.error); return; }
      if (!r.value.length) { setError("Couldn’t read a color or a count in that. Try “black ×2, navy, all M”."); return; }
      const sizes = new Set(r.value.map((x) => x.size ?? ""));
      const oneSize = sizes.size === 1 ? [...sizes][0] : "";
      if (oneSize) setSizeAll(oneSize);
      setRows((rs) => {
        const next = rs.map((x) => ({ ...x }));
        for (const o of r.value) {
          const i = next.findIndex((x) => sameColor(x.color, o.color));
          const size = oneSize || !o.size ? null : o.size;
          if (i >= 0) { next[i].quantity = Math.min(10, o.quantity); next[i].size = size; }
          else next.push({ color: o.color, size, quantity: Math.min(10, o.quantity), imageUrl: o.color ? null : product.imageUrl, picks: null, sizing: false });
        }
        return next;
      });
    });
  }
  function findPhotos(i: number) {
    const row = rows[i];
    if (!product || !row?.color) return;
    setError(undefined); setBusy("photos");
    start(async () => {
      const r = await colorPhotosAction({ name: product.name, brandText: product.brandText }, row.color!);
      setBusy(null);
      if (!r.ok) { setError(r.error); return; }
      patch(i, { picks: r.value });
      if (!r.value.length) setError(`No photos found in ${row.color}. The store's main photo will be used.`);
    });
  }
  const chosen = rows.filter((r) => r.quantity > 0);
  const total = chosen.reduce((n, r) => n + r.quantity, 0);
  function add() {
    if (!product || !total) return;
    setError(undefined); setBusy("add");
    start(async () => {
      const r = await addStoreRowsAction({
        product: { url: product.url, name: product.name, brandText: product.brandText, storeName: product.storeName, priceText: product.priceText },
        rows: chosen.map((x) => ({ color: x.color, size: x.size ?? (sizeAll || null), quantity: x.quantity, imageUrl: x.imageUrl ?? product.imageUrl })),
      });
      setBusy(null);
      if (!r.ok) { setError(r.error); return; }
      setAdded(r.value.count); setBatchId(r.value.batchId);
      router.refresh();
    });
  }
  function again() { setAdded(0); setRows((rs) => rs.map((r) => ({ ...r, quantity: 0, sizing: false }))); setWords(""); }

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
        <div className="flex flex-col gap-6" data-testid="product-card">
          <div className="flex gap-4">
            <div className="h-[170px] w-[128px] shrink-0 bg-bone">{product.imageUrl ? <img src={product.imageUrl} alt="" referrerPolicy="no-referrer" className="size-full object-contain" data-testid="product-image" /> : null}</div>
            <div className="min-w-0">
              <h2 className="serif text-[26px] leading-tight" data-testid="product-name">{product.name}</h2>
              <p className="mono mt-1 text-graphite">{[product.brandText, product.storeName, product.priceText].filter(Boolean).join(" · ")}</p>
              {product.source === "search" ? <p className="mono mt-2 normal-case text-graphite" data-testid="via-search">{product.storeName} blocked the link, so this came from a product search. Check the photo is your piece; if not, tap “find a photo” on a color.</p> : null}
            </div>
          </div>

          <section>
            <p className="mono mb-2 border-b border-ink pb-2 text-graphite">Size for all{sizeAll ? <span className="ml-2 text-ink" data-testid="chosen-size">· {sizeAll}</span> : null}</p>
            <div className="flex flex-col gap-2">
              <Pills options={product.sizes} value={sizeAll} onPick={(v) => { setSizeAll(v); setSizeTyped(""); }} testPrefix="size" />
              <form onSubmit={(e) => { e.preventDefault(); if (sizeTyped.trim()) { setSizeAll(sizeTyped.trim()); setSizeTyped(""); } }} className="flex gap-2">
                <Input id="store-size" value={sizeTyped} onChange={(e) => setSizeTyped(e.target.value)} placeholder={product.sizes.length ? "Or type a size" : "M · 32 · 8"} aria-label="Size for all" data-testid="store-size" />
                <Button type="submit" variant="outline" disabled={!sizeTyped.trim()} data-testid="size-next">Set</Button>
              </form>
              <p className="mono text-graphite">One size differs? Tap “change” on that color.</p>
            </div>
          </section>

          <section>
            <p className="mono mb-1 border-b border-ink pb-2 text-graphite">How many of each color?</p>
            <div className="flex flex-col" data-testid="color-rows">
              {rows.map((r, i) => {
                const size = r.size ?? sizeAll;
                return (
                  <div key={rowKey(r)} className="border-b border-line py-2.5" data-testid={`row-${rowKey(r)}`}>
                    <div className="flex items-center gap-3">
                      <div className="h-[56px] w-[42px] shrink-0 overflow-hidden bg-bone">{(r.imageUrl ?? product.imageUrl) ? <img src={r.imageUrl ?? product.imageUrl!} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" data-testid={`row-image-${rowKey(r)}`} /> : null}</div>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-[15px] leading-snug", r.quantity > 0 && "font-medium")}>{r.color ?? "No color given"}</p>
                        <p className="mono mt-0.5 flex flex-wrap gap-x-3 text-graphite">
                          <span>{size ? `Size ${size}` : "No size"}{r.size && r.size !== sizeAll ? " · its own" : ""}</span>
                          <button type="button" onClick={() => patch(i, { sizing: !r.sizing })} className="underline underline-offset-4" data-testid={`row-size-change-${rowKey(r)}`}>{r.sizing ? "done" : "change"}</button>
                          {canSearch && r.color && !r.imageUrl && !r.picks ? <button type="button" onClick={() => findPhotos(i)} disabled={pending} className="underline underline-offset-4" data-testid={`find-photos-${rowKey(r)}`}>{busy === "photos" ? "searching…" : "find a photo"}</button> : null}
                        </p>
                      </div>
                      <Stepper value={r.quantity} min={0} what={r.color ?? "of this"} onChange={(n) => patch(i, { quantity: n })} testId={`qty-${rowKey(r)}`} />
                    </div>
                    {r.sizing ? (
                      <div className="mt-2 flex flex-col gap-2 pl-[54px]">
                        <Pills options={product.sizes} value={size} onPick={(v) => patch(i, { size: v === sizeAll ? null : v, sizing: false })} testPrefix={`row-size-${rowKey(r)}`} />
                        <RowSizeInput value={r.size ?? ""} onSet={(v) => patch(i, { size: v && v !== sizeAll ? v : null, sizing: false })} />
                      </div>
                    ) : null}
                    {r.picks && r.picks.length ? <div className="mt-2"><PhotoPicks picks={r.picks} chosen={r.imageUrl} onPick={(u) => patch(i, { imageUrl: u })} /></div> : null}
                  </div>
                );
              })}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); addColor(newColor); }} className="mt-3 flex gap-2">
              <Input value={newColor} onChange={(e) => setNewColor(e.target.value)} placeholder={product.colors.length ? "Another color" : "Name a color"} aria-label="Another color" data-testid="new-color" />
              <Button type="submit" variant="outline" disabled={!newColor.trim()} data-testid="add-color">Add</Button>
            </form>
          </section>

          <section className="flex flex-col gap-2">
            <Field label="Or tell it in words" htmlFor="owned-words" hint="Colors, counts and a size, any way you say it. It fills the rows above.">
              <Textarea id="owned-words" value={words} onChange={(e) => setWords(e.target.value)} placeholder="I own 7 of these, all Medium: black ×2, navy, white, grey ×3" rows={2} data-testid="owned-words" />
            </Field>
            <button type="button" onClick={readWords} disabled={pending || !words.trim()} className="pill self-start" data-testid="read-words">{busy === "words" ? "Reading…" : "Read it"}</button>
          </section>

          {added === 0 ? <Button size="lg" onClick={add} disabled={pending || !total} sub={total ? `${chosen.length} ${chosen.length === 1 ? "color" : "colors"}${sizeAll ? ` · size ${sizeAll}` : ""}` : "Tap + on a color first"} data-testid="add-to-closet">{busy === "add" ? "Adding…" : `Add ${total || ""} to closet`.replace("  ", " ")}</Button> : null}
          {added > 0 ? (
            <div className="flex items-center justify-between border-y border-ink py-2.5" data-testid="added-strip">
              <span className="mono tracking-[0.1em]">{added} ready to check</span>
              <div className="flex gap-4"><button type="button" onClick={again} className="pill" data-testid="add-another-color">More of this</button><Link href={batchId ? `/add/${batchId}` : "/add"} className="pill pill-solid" data-testid="check-it">Check it →</Link></div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RowSizeInput({ value, onSet }: { value: string; onSet: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSet(v.trim()); }} className="flex gap-2">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="Or type this color’s size" aria-label="This color’s size" />
      <Button type="submit" variant="outline">Set</Button>
    </form>
  );
}

type LineState = MatchedLine & { pick: Product | null };
/** One receipt as uploaded: read in the background while the next ones upload; its lines join the list. */
type Group = { id: number; fileName: string; receipt: Receipt | null; lines: LineState[]; reading: boolean; error?: string };

/** Up to `limit` at a time: a phone keeps every request short, and three readers at once is plenty. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function ReceiptTab() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const [groups, setGroups] = useState<Group[]>([]);
  const [openPicks, setOpenPicks] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<"add" | null>(null);
  const [done, setDone] = useState<{ count: number; skipped: number; batchId: string | null } | null>(null);
  const [pending, start] = useTransition();
  const patchGroup = (id: number, changes: Partial<Group>) => setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...changes } : g)));

  async function readOne(file: File, id: number) {
    try {
      const blob = await shrinkPhoto(file);
      const signRes = await fetch("/api/uploads/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: blob.type || "image/jpeg", kind: "labels" }) });
      const signed = (await signRes.json()) as { key: string; url: string; headers: Record<string, string>; error?: string };
      if (!signRes.ok) throw new Error(signed.error || "Upload failed.");
      const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: blob });
      if (!put.ok) throw new Error("Upload failed.");
      const r = await readReceiptAction(signed.key);
      if (!r.ok) throw new Error(r.error);
      patchGroup(id, { receipt: r.value.receipt, lines: r.value.lines.map((l) => ({ ...l, pick: l.picks[0] ?? null })), reading: false, error: r.value.lines.length ? undefined : "No clothing lines were found on this one." });
    } catch (err) { patchGroup(id, { reading: false, error: (err as Error).message }); }
  }
  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 40);
    e.target.value = "";
    if (!files.length) return;
    setError(undefined); setDone(null);
    const first = nextId.current; nextId.current += files.length;
    setGroups((gs) => [...gs, ...files.map((f, i) => ({ id: first + i, fileName: f.name, receipt: null, lines: [], reading: true }))]);
    await mapLimit(files, 3, (file, i) => readOne(file, first + i));
  }
  function updateLine(gid: number, i: number, changes: Partial<LineState>) { setGroups((gs) => gs.map((g) => (g.id === gid ? { ...g, lines: g.lines.map((l, j) => (j === i ? { ...l, ...changes } : l)) } : g))); }
  const reading = groups.filter((g) => g.reading).length;
  const total = groups.reduce((n, g) => n + g.lines.reduce((m, l) => m + (l.pick ? l.quantity : 0), 0), 0);
  function add() {
    const ready = groups.filter((g) => g.receipt && g.lines.length);
    if (!ready.length) return;
    setError(undefined); setBusy("add");
    start(async () => {
      const r = await addReceiptsAction(ready.map((g) => ({ storeName: g.receipt!.storeName ?? "", purchaseDate: g.receipt!.orderDate, lines: g.lines.map((l) => ({ name: l.name, color: l.color, size: l.size, quantity: l.quantity, priceText: l.priceText, pick: l.pick })) })));
      setBusy(null);
      if (!r.ok) { setError(r.error); return; }
      setDone({ count: r.value.count, skipped: r.value.skipped, batchId: r.value.batchId });
      router.refresh();
    });
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} data-testid="receipt-file" />
      <p className="mono text-graphite">Screenshots of order emails or photos of paper receipts, as many as you like. Each is read once and deleted; only the pieces and prices are kept.</p>
      <Button size="lg" onClick={() => fileRef.current?.click()} disabled={busy === "add"} sub={groups.length ? "Add more receipts" : "Pick several at once"} data-testid="pick-receipt">Upload receipts</Button>
      {reading ? <p className="mono text-ink" role="status" data-testid="receipt-progress">Reading {groups.length - reading + 1} of {groups.length} receipts…</p> : null}
      {error ? <Banner tone="danger" title={error} /> : null}

      {groups.length ? (
        <div className="flex flex-col gap-6" data-testid="receipt-groups">
          {groups.map((g) => (
            <div key={g.id} className="flex flex-col" data-testid="receipt-group">
              <div className="flex items-end justify-between border-b border-ink pb-2">
                <p className="mono text-graphite">{g.reading ? `Reading ${g.fileName}…` : g.receipt ? [g.receipt.storeName ?? "Store", g.receipt.orderDate, g.lines.length ? `${g.lines.length} ${g.lines.length === 1 ? "line" : "lines"}` : null].filter(Boolean).join(" · ") : g.fileName}</p>
                {!g.reading ? <button type="button" onClick={() => setGroups((gs) => gs.filter((x) => x.id !== g.id))} className="pill pill-sm pill-quiet" data-testid="remove-receipt">Remove</button> : null}
              </div>
              {g.error ? <p className="mono mt-2 text-danger" data-testid="receipt-error">{g.error}</p> : null}
              {g.lines.map((l, i) => (
                <div key={i} className="border-b border-line py-3" data-testid="receipt-line">
                  <div className="flex gap-3">
                    <div className="h-[72px] w-[56px] shrink-0 overflow-hidden bg-bone">{l.pick?.imageUrl ? <img src={l.pick.imageUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" /> : null}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium leading-snug">{l.name}</p>
                      <p className="mono mt-1 text-graphite">{[l.color, l.size, l.quantity > 1 ? `×${l.quantity}` : null, l.priceText, l.pick?.query === "exact" ? "Exact item at the store" : l.pick ? "Closest match" : null].filter(Boolean).join(" · ")}</p>
                      <div className="mt-1.5 flex gap-4">
                        {l.picks.length ? <button type="button" onClick={() => setOpenPicks(openPicks === `${g.id}:${i}` ? null : `${g.id}:${i}`)} className="pill pill-sm" data-testid="pick-another">{l.pick ? "Pick another" : "Pick a photo"}</button> : <span className="mono text-graphite">No photo found · take one later</span>}
                        {l.pick ? <button type="button" onClick={() => updateLine(g.id, i, { pick: null })} className="pill pill-sm pill-quiet">Skip this one</button> : null}
                      </div>
                    </div>
                  </div>
                  {openPicks === `${g.id}:${i}` ? <div className="mt-3"><PhotoPicks picks={l.picks} chosen={l.pick?.imageUrl ?? null} onPick={(u) => { updateLine(g.id, i, { pick: l.picks.find((p) => p.imageUrl === u) ?? null }); setOpenPicks(null); }} /></div> : null}
                </div>
              ))}
            </div>
          ))}
          {done ? (
            <div className="flex items-center justify-between border-y border-ink py-2.5" data-testid="added-strip">
              <span className="mono tracking-[0.1em]">{done.count} ready to check{done.skipped ? ` · ${done.skipped} skipped` : ""}</span>
              <Link href={done.batchId ? `/add/${done.batchId}` : "/add"} className="pill pill-solid" data-testid="check-it">Check it →</Link>
            </div>
          ) : (
            <Button size="lg" onClick={add} disabled={pending || !total || reading > 0} sub={reading ? "Still reading" : groups.length > 1 ? `From ${groups.filter((g) => g.receipt).length} receipts` : undefined} data-testid="add-receipt">{busy === "add" ? "Adding…" : `Add ${total} piece${total === 1 ? "" : "s"}`}</Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

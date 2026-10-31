"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import type { WantView } from "@/lib/shop/wants";
import { addWantAction } from "./actions";
import { rememberShopForAction } from "../actions";
import { WantSheet } from "./want-sheet";
import { useRefreshWhile, useWantSearch } from "./use-want-search";
import { ago } from "./ago";

/**
 * "Looking for" (Jeff, 23 Oct 2026, Shop v2 item 2): the lines on someone's list, each with what is new, what was
 * found so far and when the stores were last checked. Add a line and the stores are searched at once in the
 * background; every day after that on the schedule in Admin → Rules.
 */
export function LookingForScreen({ meId, people, forPersonId, wants }: { meId: string; people: { id: string; name: string }[]; forPersonId: string; wants: WantView[] }) {
  const [sheet, setSheet] = useState<"add" | "for" | null>(null);
  const router = useRouter();
  const [, startFor] = useTransition();
  const [pendingText, setPendingText] = useState("");
  const [prefill, setPrefill] = useState("");
  const { searching, error, run, secondsOf } = useWantSearch();
  const forName = people.find((p) => p.id === forPersonId)?.name ?? "me";
  const open = wants.filter((w) => !w.foundAt);
  const found = wants.filter((w) => w.foundAt);
  const pendingNew = searching["new"];
  // a row still on its first search that this screen did not start (added from another screen or device): keep asking
  useRefreshWhile(open.some((w) => !w.lastSearchedAt && !searching[w.id]));

  return (
    <div data-testid="looking-for" className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-x-14">
      <div className="order-1 lg:col-span-2">
        <PageHeader
          eyebrow={<button type="button" onClick={() => setSheet("for")} className="pill pill-sm" aria-haspopup="dialog" data-testid="looking-for-for">For {forPersonId === meId ? "me" : forName} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="m6 9 6 6 6-6" /></svg></button>}
          title="Looking" accent="for" aside={open.length ? `${open.length} open` : undefined} />
      </div>
      {error ? <Banner tone="danger" title={error} className="mb-3 lg:col-span-2" /> : null}

      <div className="order-2 lg:col-start-2 lg:row-start-2 lg:self-start lg:sticky lg:top-24">
        <Button size="lg" className="w-full" sub="Searched now, then every day" onClick={() => { setPrefill(""); setSheet("add"); }} data-testid="want-add">Add something to find</Button>
        <p className="mt-4 text-[14px] leading-snug text-graphite">Say it the way you would to a friend, like “navy cashmere crewneck under $200”. The Shop searches the stores now and again every day, and says here and on Today when something new turns up.</p>
      </div>

      <section className="order-3 mt-6 lg:col-start-1 lg:row-start-2 lg:mt-0">
        {pendingNew ? (
          <div className="flex min-h-[64px] items-center justify-between gap-3 border-b border-line py-3" data-testid="want-row-pending">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-medium">{pendingText || "New line"}</span>
              <span className="mono block text-graphite" aria-live="polite">{pendingNew.step} <span aria-hidden>· {secondsOf(pendingNew)}s</span></span>
            </span>
          </div>
        ) : null}
        {open.length === 0 && !pendingNew ? (
          <div data-testid="looking-for-empty">
            <p className="serif text-[21px] italic leading-[1.3]">Nothing on {forPersonId === meId ? "your" : `${forName}’s`} list yet. Tap one to start from it, or add your own.</p>
            <ul className="mt-4 flex flex-col gap-2">
              {["navy cashmere crewneck under $200", "white leather sneakers, size 10", "a rain jacket that packs small"].map((ex) => (
                <li key={ex}><button type="button" onClick={() => { setPrefill(ex); setSheet("add"); }} className="tap flex h-12 w-full items-center justify-between border-b border-line text-left text-[15px]" data-testid="want-example"><span>“{ex}”</span><span className="mono text-graphite">Use it</span></button></li>
              ))}
            </ul>
          </div>
        ) : open.map((w) => {
          const s = searching[w.id];
          const stores = new Set(w.matches.map((m) => m.storeName)).size;
          return (
            <Link key={w.id} href={`/shop/looking-for/${w.id}`} className="tap flex min-h-[64px] items-center justify-between gap-3 border-b border-line py-3" data-testid="want-row">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-medium">{w.text}</span>
                <span className="mono block text-graphite" data-testid="want-row-line" suppressHydrationWarning>
                  {s ? <>{s.step} <span className="text-graphite">· {secondsOf(s)}s</span></>
                    : !w.lastSearchedAt ? "Searching the stores…"
                    : w.matches.length ? `${w.matches.length} ${w.matches.length === 1 ? "match" : "matches"} · ${stores} ${stores === 1 ? "store" : "stores"} · checked ${ago(w.lastSearchedAt)}`
                    : `Nothing in the stores yet · checked ${ago(w.lastSearchedAt)}`}
                </span>
              </span>
              {w.newCount > 0 ? <span className="mono shrink-0 border border-ink px-2 py-1 text-ink" data-testid="want-new">{w.newCount} new</span>
                : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="shrink-0 text-graphite"><path d="m9 6 6 6-6 6" /></svg>}
            </Link>
          );
        })}
        {found.length ? (
          <div className="mt-8" data-testid="found-list">
            <p className="mono border-b border-ink pb-2 text-graphite">Found</p>
            {found.map((w) => (
              <Link key={w.id} href={`/shop/looking-for/${w.id}`} className="flex h-[52px] items-center justify-between gap-3 border-b border-line hover:bg-bone" data-testid="found-row">
                <span className="min-w-0 flex-1 truncate text-[15px] text-graphite line-through decoration-1">{w.text}</span>
                <span className="mono shrink-0 text-graphite" suppressHydrationWarning>found {ago(w.foundAt)}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      <WantSheet open={sheet === "add"} onClose={() => setSheet(null)} title="Looking for…" value={prefill} onSave={(text) => { setPendingText(text); void run("new", () => addWantAction(forPersonId, text)); }} />
      <Sheet open={sheet === "for"} onClose={() => setSheet(null)} title="Whose list">
        <div className="flex flex-col" role="listbox">
          {people.map((p) => <button key={p.id} type="button" role="option" aria-selected={p.id === forPersonId} onClick={() => { setSheet(null); startFor(async () => { await rememberShopForAction(p.id); router.push(`/shop/looking-for?for=${p.id}`); }); }} className="tap w-full flex h-12 items-center justify-between border-b border-line text-[15px]"><span>{p.id === meId ? `${p.name} (me)` : p.name}</span><span className={cn("mono", p.id === forPersonId ? "text-ink" : "text-transparent")}>✓</span></button>)}
        </div>
        <p className="mono mt-4 text-graphite">You can keep a list for yourself, your kids, and anyone who allowed it in their Settings.</p>
      </Sheet>
    </div>
  );
}

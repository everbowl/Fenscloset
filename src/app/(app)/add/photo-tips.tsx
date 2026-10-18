"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import type { AddTips } from "@/lib/tips";
import { setAddTipsHiddenAction } from "./actions";

/**
 * Photo tips on Add clothes: the general rules, then a tab per category with its own tip
 * (admins edit those under Lists → Categories). DON'T SHOW AGAIN hides it for this person;
 * a small PHOTO TIPS link brings it back.
 */
export function PhotoTips({ tips, isAdmin }: { tips: AddTips; isAdmin: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [cat, setCat] = useState(tips.categories[0]?.id ?? null);
  const toggle = (hidden: boolean) => start(async () => { await setAddTipsHiddenAction(hidden); router.refresh(); });
  if (tips.hidden) {
    return <button type="button" onClick={() => toggle(false)} className="mono mt-3 py-2 text-graphite" data-testid="show-tips">Photo tips</button>;
  }
  const current = tips.categories.find((c) => c.id === cat) ?? tips.categories[0];
  return (
    <section className="mt-5 border-t border-ink pt-3" data-testid="photo-tips">
      <div className="flex items-end justify-between">
        <p className="serif text-[22px]">Before you <em>start</em></p>
        <button type="button" onClick={() => toggle(true)} className="mono py-2 text-graphite" data-testid="hide-tips">Don’t show again</button>
      </div>
      <ol className="mt-2 space-y-1.5">
        {tips.general.map((t, i) => (
          <li key={i} className="flex gap-3 text-[14px] leading-snug"><span className="mono mt-[3px] w-5 shrink-0 text-graphite">{String(i + 1).padStart(2, "0")}</span><span>{t}</span></li>
        ))}
      </ol>
      {tips.categories.length ? (
        <div className="mt-4">
          <div className="flex items-center justify-between border-b border-ink pb-2">
            <p className="mono text-graphite">Tips by piece</p>
            {isAdmin ? <Link href="/admin/lists/category" className="mono text-ink">Edit</Link> : null}
          </div>
          <div className="-mx-5 mt-2 flex gap-[18px] overflow-x-auto px-5 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0" role="tablist">
            {tips.categories.map((c) => (
              <button key={c.id} type="button" role="tab" aria-selected={current?.id === c.id} onClick={() => setCat(c.id)}
                className={cn("mono mono-11 shrink-0 py-2", current?.id === c.id ? "border-b-[1.5px] border-ink text-ink" : "text-graphite")} data-testid={`tip-tab-${c.name}`}>
                {c.name}
              </button>
            ))}
          </div>
          {current ? <p className="mt-2 text-[14px] leading-snug" data-testid="tip-text">{current.tip}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

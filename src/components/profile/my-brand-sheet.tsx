"use client";

import { useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Row } from "@/components/items/row-editor";
import { SizeSheet } from "@/components/profile/size-sheet";
import type { MyBrand } from "@/lib/profiles/brands";
import type { CategorySizes } from "@/lib/profiles/sizes";
import { likelyFor, type LikelySizes } from "@/lib/profiles/size-options";
import { setMyBrandAction } from "@/app/(app)/profile/actions";

/**
 * A person's size per item type in one brand, plus the brand's store link: the Brands page, and the Closet's
 * What's-needed row for a favorite brand with no size yet. Only the types tapped are saved. Mount it to open it
 * (key it by the brand), unmount it to close.
 */
export function MyBrandSheet({ ownerId, brand, sizeOptions, likely, onClose, onSaved, onError }: {
  ownerId: string; brand: MyBrand; sizeOptions: CategorySizes[]; likely: LikelySizes | null; onClose: () => void; onSaved?: () => void; onError?: (message: string) => void;
}) {
  const [url, setUrl] = useState(brand.url ?? "");
  /** category id ("" = any) → size; only the ones touched in this sheet are saved. */
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const [sizeFor, setSizeFor] = useState<CategorySizes | null>(null);
  const [, start] = useTransition();
  const current = (categoryId: string | null) => {
    const key = categoryId ?? "";
    if (key in picked) return picked[key];
    return brand.sizes.find((s) => s.categoryId === categoryId)?.size ?? null;
  };
  const anySizes = brand.sizes.filter((s) => s.categoryId === null);
  function save() {
    const sizes = Object.entries(picked).map(([k, size]) => ({ categoryId: k || null, size }));
    onClose();
    start(async () => { const r = await setMyBrandAction(ownerId, { brandId: brand.brandId, url, sizes }); if (!r.ok) onError?.(r.error); onSaved?.(); });
  }
  return (
    <>
      <Sheet open onClose={onClose} title={brand.name}>
        <div className="flex flex-col gap-5">
          <section>
            <p className="mono border-b border-ink pb-2 text-graphite">Your size by item type</p>
            {sizeOptions.map((c) => {
              const v = current(c.categoryId);
              const hint = likelyFor(likely, c.categoryName);
              return <Row key={c.categoryId} label={c.categoryName} value={v ?? (hint ? `Likely ${hint} · tap to set` : "Tap to set")} muted={!v} onClick={() => setSizeFor(c)} testId={`my-size-${c.categoryName.toLowerCase()}`} />;
            })}
            {anySizes.map(() => <Row key="any" label="Any item" value={current(null) ?? "Cleared"} muted={!current(null)} onClick={() => setSizeFor({ categoryId: "", categoryName: "Any item", options: [] })} />)}
            <p className="mono mt-2 text-graphite">Tap only the types you buy from this brand.</p>
          </section>
          <Field label="Store link" htmlFor="my-brand-url" hint="Where you buy it. New pieces of this brand get this link."><Input id="my-brand-url" inputMode="url" autoCapitalize="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://shop.lululemon.com" data-testid="my-brand-url" /></Field>
          <Button size="lg" onClick={save} data-testid="save-my-brand">Save</Button>
        </div>
      </Sheet>
      <SizeSheet open={Boolean(sizeFor)} onClose={() => setSizeFor(null)} title={sizeFor ? `${brand.name} · ${sizeFor.categoryName}` : ""} options={sizeFor?.options ?? []} value={sizeFor ? current(sizeFor.categoryId || null) : null} suggested={sizeFor ? likelyFor(likely, sizeFor.categoryName) : null}
        onPick={(v) => { if (sizeFor) setPicked((p) => ({ ...p, [sizeFor.categoryId]: v })); }} />
    </>
  );
}

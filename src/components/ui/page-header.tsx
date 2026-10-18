import type { ReactNode } from "react";

/**
 * Editorial page title: Instrument Serif with an optional italic accent word, and a mono aside
 * on the right ("142 PIECES", "01 / 03"). Matches the mockups' 44px title block.
 */
export function PageHeader({ title, accent, aside, action, eyebrow }: {
  title: string; accent?: string; aside?: ReactNode; action?: ReactNode; eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-4">
      {eyebrow ? <div className="mono text-graphite leading-[1.6] mb-2.5">{eyebrow}</div> : null}
      <div className="flex items-end justify-between gap-3">
        <h1 className="serif text-[44px]">{title}{accent ? <> <em>{accent}</em></> : null}</h1>
        {aside ? <div className="mono mono-11 text-graphite pb-1.5">{aside}</div> : action ? <div className="pb-1">{action}</div> : null}
      </div>
    </header>
  );
}

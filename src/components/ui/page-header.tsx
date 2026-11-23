import type { ReactNode } from "react";

/** Page title: 28px semibold, with an optional second word, and a caption or an action on the right. */
export function PageHeader({ title, accent, aside, action, eyebrow }: {
  title: string; accent?: string; aside?: ReactNode; action?: ReactNode; eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-4">
      {eyebrow ? <div className="caption mb-1.5">{eyebrow}</div> : null}
      <div className="flex items-end justify-between gap-3">
        <h1 className="title">{title}{accent ? ` ${accent}` : ""}</h1>
        {aside ? <div className="caption pb-1">{aside}</div> : action ? <div className="pb-0.5">{action}</div> : null}
      </div>
    </header>
  );
}

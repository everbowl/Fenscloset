import type { ReactNode } from "react";

/** Bone block with a mono line, the way the mockups show an empty slot. */
export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 bg-bone px-6 py-14 text-center ${className ?? ""}`}>
      {icon ? <div className="text-ink">{icon}</div> : null}
      <p className="mono mono-11">{title}</p>
      {body ? <p className="max-w-xs text-[13px] leading-snug text-graphite">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

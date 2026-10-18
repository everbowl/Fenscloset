import type { ReactNode } from "react";

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-stone-400">{icon}</div> : null}
      <p className="font-medium">{title}</p>
      {body ? <p className="mt-1 max-w-xs text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { plainError } from "@/app/(app)/add/add-screen";
import { LetThemGo } from "@/app/(app)/add/let-them-go";

/** The photos that could not be tagged, on All done: try them again, or let them go and clear the pile. */
export function FailedActions({ batchId, ids, error }: { batchId: string; ids: string[]; error: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"retry" | null>(null);
  return (
    <Banner tone="danger" title={`${ids.length} photo${ids.length > 1 ? "s" : ""} could not be tagged`} className="mt-4" data-testid="failed-actions">
      <p className="text-[13px]">{plainError(error)}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="pill" disabled={busy !== null} data-testid="failed-retry" onClick={async () => { setBusy("retry"); await Promise.all(ids.map((id) => fetch(`/api/import/entries/${id}/process`, { method: "POST" }))); setBusy(null); router.refresh(); }}>{busy === "retry" ? "Trying…" : "Try again"}</button>
        <LetThemGo batchId={batchId} count={ids.length} onDone={() => router.refresh()} />
      </div>
    </Banner>
  );
}

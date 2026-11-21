"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { abandonBatchAction } from "@/app/(flow)/add/[batchId]/actions";

/** Only failed photos are left in the batch: let them go and the pile is clear. A whole batch asks first (Q1). */
export function LetThemGo({ batchId, count, onDone }: { batchId: string; count: number; onDone: () => Promise<void> | void }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = `${count} photo${count === 1 ? "" : "s"}`;
  return (
    <>
      <button type="button" className="pill pill-quiet" data-testid="let-them-go" onClick={() => setAsk(true)}>Let them go</button>
      <Sheet open={ask} onClose={() => setAsk(false)} title={`Let ${n} go?`}>
        <p className="text-[14px] leading-snug text-graphite">They leave the pile for good. You can add them again any time from your camera roll.</p>
        <div className="mt-5 flex gap-2.5">
          <button type="button" className="pill pill-quiet h-[50px] flex-1" onClick={() => setAsk(false)}>Keep them</button>
          <Button variant="danger" className="flex-1" disabled={busy} data-testid="let-them-go-confirm" onClick={async () => { setBusy(true); await abandonBatchAction(batchId); setAsk(false); setBusy(false); await onDone(); }}>{busy ? "Clearing…" : "Let them go"}</Button>
        </div>
      </Sheet>
    </>
  );
}

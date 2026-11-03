"use client";

import { useRef, useState, type ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";
import { shrinkPhoto } from "@/lib/import/client-queue";
import { addBodyPhotoAction } from "@/app/(app)/profile/actions";

export type BodyPhotoView = "front" | "back" | "left" | "right" | "side";

/**
 * One body-photo upload for every place that asks for one (the Body page, the Closet's What's-needed strip): the
 * picture is shrunk, signed into the person's own `bodies/` folder, and recorded with its view and who may see it.
 * `pick(view, onlyMe)` opens the camera or the photo picker; `input` must be rendered once.
 */
export function useBodyPhotoUpload(ownerId: string, onDone?: () => void, testId = "body-photo") {
  const fileRef = useRef<HTMLInputElement>(null);
  const next = useRef<{ view: BodyPhotoView; onlyMe: boolean }>({ view: "front", onlyMe: false });
  const [uploading, setUploading] = useState<BodyPhotoView | null>(null);
  const [error, setError] = useState<string>();

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    const { view, onlyMe } = next.current;
    setUploading(view); setError(undefined);
    try {
      const blob = await shrinkPhoto(file);
      const signRes = await fetch("/api/uploads/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: blob.type || "image/jpeg", kind: "bodies", ownerId }) });
      const signed = (await signRes.json()) as { key: string; url: string; headers: Record<string, string>; error?: string };
      if (!signRes.ok) throw new Error(signed.error || "Upload failed.");
      const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: blob });
      if (!put.ok) throw new Error("Upload failed.");
      const r = await addBodyPhotoAction(ownerId, signed.key, onlyMe, view);
      if (!r.ok) throw new Error(r.error);
      onDone?.();
    } catch (err) { setError((err as Error).message); } finally { setUploading(null); }
  }
  const pick = (view: BodyPhotoView, onlyMe: boolean) => { next.current = { view, onlyMe }; fileRef.current?.click(); };
  const input: ReactNode = <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onChange} data-testid={testId} />;
  return { input, pick, uploading, error };
}

/** Only me, or everyone who can see the body profile: asked before each body photo (Q1). */
export function PhotoPrivacySheet({ open, onClose, onPick, visibleTo, testIdPrefix = "photo" }: {
  open: boolean; onClose: () => void; onPick: (onlyMe: boolean) => void; visibleTo: string[]; testIdPrefix?: string;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Who can see this photo?">
      <div className="flex flex-col">
        <button type="button" data-testid={`${testIdPrefix}-only-me`} onClick={() => onPick(true)} className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-2 text-left text-[15px]">
          <span>Only me<span className="mono block text-graphite">Nobody else, ever · the AI still uses it to dress you</span></span>
        </button>
        <button type="button" data-testid={`${testIdPrefix}-shared`} onClick={() => onPick(false)} className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-2 text-left text-[15px]">
          <span>Everyone who can see my body profile<span className="mono block text-graphite">Currently {visibleTo.join(", ")}</span></span>
        </button>
      </div>
    </Sheet>
  );
}

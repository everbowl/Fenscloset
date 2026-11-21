import { notFound } from "next/navigation";
import { requirePerson } from "@/lib/auth/current";
import { getLook } from "@/lib/looks/service";
import { hasBackPhoto, mirrorEngines, tryOnState } from "@/lib/tryon";
import { isMannequinConfigured } from "@/lib/tryon/mannequin";
import { canDress } from "@/lib/outfits/engine";
import { listClosetItems } from "@/lib/items/query";
import { LookScreen } from "./look-screen";

export const metadata = { title: "Look" };
export const dynamic = "force-dynamic";

/** One look (B1): its pieces with their Buy links, the mirror, more from the closet, a name to save it under Fits. */
export default async function LookPage({ params }: { params: Promise<{ lookId: string }> }) {
  const me = await requirePerson();
  const { lookId } = await params;
  const look = await getLook(me, lookId);
  if (!look) notFound();
  const [tryOn, dress, closet, { engines }] = await Promise.all([
    tryOnState(me, look.personId), canDress(me, look.personId), listClosetItems({ kind: "person", personId: look.personId, name: "" }), mirrorEngines(),
  ]);
  const backPhoto = tryOn === "ready" && (await hasBackPhoto(look.personId));
  return (
    <LookScreen look={{ ...look, savedAt: look.savedAt?.toISOString() ?? null }} meId={me.id} tryOn={tryOn} mannequin={dress && isMannequinConfigured()} backPhoto={backPhoto}
      engine={engines[0] ?? "google"} admin={me.role === "admin"} closet={closet.map((c) => ({ id: c.id, name: c.name, thumbKey: c.thumbKey, categoryName: c.categoryName }))} />
  );
}

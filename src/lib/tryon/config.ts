import { hasBackPhoto, mirrorEngines, tryOnState, type TryOnState } from "@/lib/tryon";
import { isMannequinConfigured } from "@/lib/tryon/mannequin";
import { mirrorWardrobe } from "@/lib/tryon/wardrobe";
import type { Wardrobe } from "@/lib/tryon/complete";
import type { Engine } from "@/lib/tryon/engines";
import type { Viewer } from "@/lib/people/visibility";

/** What the mirror can do for the signed-in person on a closet screen: on their own photo, from behind, on the mannequin; their placeable pieces for completing a look; who dresses. */
export type MirrorConfig = { personId: string; personName: string; tryOn: TryOnState; backPhoto: boolean; mannequinAvailable: boolean; wardrobe: Wardrobe; engine: Engine; /** Admins see which engine dressed a picture; the family just sees the picture. */ admin: boolean };

export async function mirrorConfig(viewer: Viewer & { name: string }): Promise<MirrorConfig> {
  const [tryOn, wardrobe, { engines }] = await Promise.all([tryOnState(viewer, viewer.id), mirrorWardrobe(viewer.id), mirrorEngines()]);
  return {
    personId: viewer.id,
    personName: viewer.name.split(" ")[0],
    tryOn,
    backPhoto: tryOn === "ready" && (await hasBackPhoto(viewer.id)),
    mannequinAvailable: isMannequinConfigured(),
    wardrobe,
    engine: engines[0] ?? "google",
    admin: viewer.role === "admin",
  };
}

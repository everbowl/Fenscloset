import { hasBackPhoto, tryOnState, type TryOnState } from "@/lib/tryon";
import { isMannequinConfigured } from "@/lib/tryon/mannequin";
import type { Viewer } from "@/lib/people/visibility";

/** What the mirror can do for the signed-in person on a closet screen: on their own photo, from behind, on the mannequin. */
export type MirrorConfig = { personId: string; personName: string; tryOn: TryOnState; backPhoto: boolean; mannequinAvailable: boolean };

export async function mirrorConfig(viewer: Viewer & { name: string }): Promise<MirrorConfig> {
  const tryOn = await tryOnState(viewer, viewer.id);
  return {
    personId: viewer.id,
    personName: viewer.name.split(" ")[0],
    tryOn,
    backPhoto: tryOn === "ready" && (await hasBackPhoto(viewer.id)),
    mannequinAvailable: isMannequinConfigured(),
  };
}

import { db } from "@/lib/db";
import { getRuleNumber } from "@/lib/rules";
import { isTryOnConfigured } from "@/lib/tryon";
export { noteBodyPhotoProblem } from "@/lib/tryon";
import { sectionOf } from "@/lib/shop/section";
import { ProfileError } from "@/lib/profiles/service";
import type { Viewer } from "@/lib/people/visibility";

/**
 * "What's needed" at the top of a person's own closet (Jeff, 2 Nov 2026: "on the individual closet page, I should
 * have a what's needed or suggested, so if I need to provide another selfie for the mirror to be better, or
 * whatever"; D1: the Closet page only). One row per gap, the fix in the row: a front photo so the mirror can dress
 * the person, a retake when an engine could not make out the body, the shop section, a size in a favorite brand,
 * pieces still wearing the store's photo, a back photo for looks from behind. "Not now" hides a row for
 * needSnoozeDays (Admin → Rules, 30 by default). Minors never reach the mirror, so they get no body rows.
 */

export type NeedKind = "body-retake" | "body-front" | "body-back" | "section" | "size" | "store-photos";
export type Need = {
  key: string; kind: NeedKind; title: string; detail: string;
  /** Body rows: which photo to add or retake. */
  view?: "front" | "back";
  /** Size rows: the favorite brand with no size yet. */
  brandId?: string; brandName?: string; brandUrl?: string | null;
  /** Store-photo rows: how many pieces. */
  count?: number;
};

export const DEFAULT_SNOOZE_DAYS = 30;
const KEY = /^(body-retake|body-retake-back|body-front|body-back|section|store-photos|size-[a-z0-9]+)$/;

/** The rows for a person's own closet, most pressing first, minus the ones hidden with Not now. */
export async function listNeeds(viewer: Viewer, personId: string): Promise<Need[]> {
  if (viewer.id !== personId) return []; // the strip is the owner's: nobody is nudged about someone else's closet
  const now = new Date();
  const [person, snoozed, section, photos, storePhotos] = await Promise.all([
    db.person.findUniqueOrThrow({
      where: { id: personId },
      select: { role: true, tryOnEnabled: true, favoriteBrands: { where: { isArchived: false }, orderBy: { name: "asc" }, select: { id: true, name: true, url: true, sizes: { where: { personId }, select: { id: true } } } } },
    }),
    db.needSnooze.findMany({ where: { personId, until: { gt: now } }, select: { key: true } }),
    sectionOf(personId),
    db.bodyPhoto.findMany({ where: { personId }, orderBy: { takenAt: "desc" }, select: { view: true, problem: true } }),
    db.item.count({ where: { ownerId: personId, retiredAt: null, storePhoto: true } }),
  ]);
  const needs: Need[] = [];
  const mirror = person.role !== "minor" && person.tryOnEnabled && isTryOnConfigured();
  const hasFront = photos.some((p) => p.view === "front");
  if (mirror) {
    const front = photos.find((p) => p.view === "front") ?? photos[0]; // the mirror dresses the front photo, else the newest of any view
    const back = photos.find((p) => p.view === "back");
    if (front?.problem) needs.push({ key: "body-retake", kind: "body-retake", view: "front", title: "The mirror couldn’t read your front photo", detail: front.problem });
    if (back?.problem) needs.push({ key: "body-retake-back", kind: "body-retake", view: "back", title: "The mirror couldn’t read your back photo", detail: back.problem });
    if (!hasFront) needs.push({ key: "body-front", kind: "body-front", view: "front", title: "A front photo, so the mirror can dress you", detail: "Full body, facing the camera, in a fitted tee and pants. Only you see it unless you say otherwise." });
  }
  if (!section) needs.push({ key: "section", kind: "section", title: "Which section do you shop in?", detail: "Every store search carries it, so the other section stays out." });
  for (const b of person.favoriteBrands) {
    if (b.sizes.length) continue;
    needs.push({ key: `size-${b.id}`, kind: "size", brandId: b.id, brandName: b.name, brandUrl: b.url, title: `Your size in ${b.name}`, detail: "One tap when you add clothes brings it along, and the Shop looks for that size." });
  }
  if (storePhotos > 0) {
    needs.push({ key: "store-photos", kind: "store-photos", count: storePhotos, title: storePhotos === 1 ? "1 piece still wears the store’s photo" : `${storePhotos} pieces still wear the store’s photo`, detail: "Snap yours when you can, so each card shows the piece you own." });
  }
  if (mirror && photos.length && !photos.some((p) => p.view === "back")) {
    needs.push({ key: "body-back", kind: "body-back", view: "back", title: "A back photo, to see looks from behind", detail: "Same spot, same clothes, turned around." });
  }
  const hidden = new Set(snoozed.map((s) => s.key));
  return needs.filter((n) => !hidden.has(n.key));
}

/** Not now: the row stays hidden for the household's needSnoozeDays. Returns when it comes back. */
export async function snoozeNeed(viewer: Viewer, key: string): Promise<Date> {
  if (!KEY.test(key)) throw new ProfileError("That row is not one of the needs.");
  const days = await getRuleNumber("needSnoozeDays", DEFAULT_SNOOZE_DAYS);
  const until = new Date(Date.now() + Math.max(1, days) * 86_400_000);
  await db.needSnooze.upsert({ where: { personId_key: { personId: viewer.id, key } }, update: { until }, create: { personId: viewer.id, key, until } });
  await db.needSnooze.deleteMany({ where: { personId: viewer.id, until: { lte: new Date() } } }); // rows that ran out go
  return until;
}

import { db } from "@/lib/db";
import { isMockAi, structured } from "@/lib/ai/claude";
import { newKey, putObject, deleteObject } from "@/lib/storage";
import type { Viewer } from "@/lib/people/visibility";

/**
 * Daily check-in: one answer per editable scale (tan / hair / skin by default), by taps or from a selfie.
 * Only the owner (and a minor's parents) can read or write a person's check-in; the selfie is seen by them alone.
 */

export class CheckInError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "CheckInError";
  }
}

export type Scale = { id: string; name: string; options: { id: string; name: string }[] };
export type CheckInView = {
  date: string;
  source: "taps" | "selfie";
  selfieKey: string | null;
  answers: { scaleId: string; scaleName: string; optionId: string; optionName: string }[];
};

export async function getScales(): Promise<Scale[]> {
  const scales = await db.checkInScale.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" }, include: { options: { where: { isArchived: false }, orderBy: { sortOrder: "asc" } } } });
  return scales.map((s) => ({ id: s.id, name: s.name, options: s.options.map((o) => ({ id: o.id, name: o.name })) }));
}

export async function canTouchCheckIn(viewer: Viewer, personId: string): Promise<boolean> {
  if (viewer.id === personId) return true;
  return Boolean(await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: personId, parentId: viewer.id } } }));
}

async function assertCanTouch(viewer: Viewer, personId: string) {
  if (!(await canTouchCheckIn(viewer, personId))) throw new CheckInError("Only the person (or their parent) can check in for them.", 403);
}

export async function getCheckIn(viewer: Viewer, personId: string, date: string): Promise<CheckInView | null> {
  if (!(await canTouchCheckIn(viewer, personId))) return null;
  const c = await db.checkIn.findUnique({ where: { personId_date: { personId, date } }, include: { answers: { include: { scale: true, option: true } } } });
  if (!c) return null;
  return { date: c.date, source: c.source, selfieKey: c.selfieKey, answers: c.answers.map((a) => ({ scaleId: a.scaleId, scaleName: a.scale.name, optionId: a.optionId, optionName: a.option.name })) };
}

async function save(personId: string, date: string, source: "taps" | "selfie", answers: { scaleId: string; optionId: string }[], selfieKey: string | null) {
  const scales = await getScales();
  for (const a of answers) {
    const s = scales.find((x) => x.id === a.scaleId);
    if (!s || !s.options.some((o) => o.id === a.optionId)) throw new CheckInError("That answer isn't on the list anymore.");
  }
  const existing = await db.checkIn.findUnique({ where: { personId_date: { personId, date } } });
  if (existing?.selfieKey && existing.selfieKey !== selfieKey) await deleteObject(existing.selfieKey).catch(() => {});
  await db.$transaction(async (tx) => {
    const row = await tx.checkIn.upsert({
      where: { personId_date: { personId, date } },
      update: { source, selfieKey: selfieKey ?? (source === "taps" ? null : undefined) },
      create: { personId, date, source, selfieKey },
    });
    await tx.checkInAnswer.deleteMany({ where: { checkInId: row.id } });
    if (answers.length) await tx.checkInAnswer.createMany({ data: answers.map((a) => ({ checkInId: row.id, scaleId: a.scaleId, optionId: a.optionId })) });
  });
}

export async function saveTaps(viewer: Viewer, personId: string, date: string, answers: { scaleId: string; optionId: string }[]): Promise<void> {
  await assertCanTouch(viewer, personId);
  await save(personId, date, "taps", answers, null);
}

/** Read the selfie with Claude, map to the scales' options, store the selfie under `checkins/<personId>/`. */
export async function saveSelfie(viewer: Viewer, personId: string, date: string, image: { data: Buffer; contentType: "image/jpeg" | "image/png" | "image/webp" }): Promise<CheckInView> {
  await assertCanTouch(viewer, personId);
  const scales = await getScales();
  const answers = await readSelfie(image, scales);
  const key = newKey("checkins", personId, image.contentType);
  await putObject(key, image.data, image.contentType);
  await save(personId, date, "selfie", answers, key);
  return (await getCheckIn(viewer, personId, date))!;
}

export async function readSelfie(image: { data: Buffer; contentType: "image/jpeg" | "image/png" | "image/webp" }, scales: Scale[]): Promise<{ scaleId: string; optionId: string }[]> {
  const usable = scales.filter((s) => s.options.length);
  if (!usable.length) return [];
  if (isMockAi()) return usable.map((s) => ({ scaleId: s.id, optionId: s.options[Math.min(1, s.options.length - 1)].id }));
  const properties: Record<string, unknown> = {};
  for (const s of usable) properties[s.name] = { type: "string", enum: s.options.map((o) => o.name) };
  const schema = { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
  const result = await structured<Record<string, string>>({
    system: "You look at one selfie and describe the person's current appearance using only the given scales. Pick exactly one option per scale. This is for choosing clothes today; be kind and neutral.",
    prompt: `Scales and options:\n${usable.map((s) => `- ${s.name}: ${s.options.map((o) => o.name).join(" / ")}`).join("\n")}\nAnswer with one option per scale.`,
    image: { data: image.data.toString("base64"), mediaType: image.contentType },
    schema, effort: "low", maxTokens: 300,
  });
  return usable.flatMap((s) => {
    const o = s.options.find((x) => x.name === result[s.name]);
    return o ? [{ scaleId: s.id, optionId: o.id }] : [];
  });
}

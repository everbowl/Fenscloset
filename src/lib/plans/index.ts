import { db } from "@/lib/db";
import { clock } from "@/lib/dates";
import { nextEventToday } from "@/lib/plans/google";
import type { Viewer } from "@/lib/people/visibility";

/**
 * "What's the plan today?" — the occasion that shapes the looks.
 * Order: the person's own pick for the day (DayPlan) → the next Google Calendar event → nothing (the engine assumes everyday).
 */

export type Plan =
  | { source: "pick"; occasionId: string | null; label: string }
  | { source: "calendar"; occasionId: null; label: string; at: Date | null }
  | { source: "none"; occasionId: null; label: null };

export class PlanError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "PlanError";
  }
}

async function canTouch(viewer: Viewer, personId: string): Promise<boolean> {
  if (viewer.id === personId) return true;
  return Boolean(await db.guardianLink.findUnique({ where: { minorId_parentId: { minorId: personId, parentId: viewer.id } } }));
}

export async function getPlan(personId: string, date: string, tz: string, now = new Date()): Promise<Plan> {
  const pick = await db.dayPlan.findUnique({ where: { personId_date: { personId, date } }, include: { occasion: true } });
  if (pick && (pick.occasion || pick.text)) return { source: "pick", occasionId: pick.occasionId, label: pick.occasion?.name ?? pick.text! };
  try {
    const ev = await nextEventToday(personId, tz, now);
    if (ev) return { source: "calendar", occasionId: null, label: ev.summary, at: ev.allDay ? null : ev.start };
  } catch (e) {
    console.error("calendar", e);
  }
  return { source: "none", occasionId: null, label: null };
}

/** `DINNER 7:30 PM` / `DENTIST` for the context line. */
export function planLine(plan: Plan, tz: string): string | null {
  if (plan.source === "none") return null;
  const label = plan.label.toUpperCase();
  return plan.source === "calendar" && plan.at ? `${label} ${clock(plan.at, tz).toUpperCase()}` : label;
}

/** Pick an occasion from the editable list (or free text) for a day; `null` clears the pick and the calendar is used again. */
export async function setPlan(viewer: Viewer, personId: string, date: string, pick: { occasionId: string } | { text: string } | null): Promise<void> {
  if (!(await canTouch(viewer, personId))) throw new PlanError("Only the person (or their parent) can set their plan.", 403);
  if (!pick) { await db.dayPlan.deleteMany({ where: { personId, date } }); return; }
  if ("occasionId" in pick) {
    const occ = await db.occasion.findFirst({ where: { id: pick.occasionId, isArchived: false } });
    if (!occ) throw new PlanError("That occasion isn't on the list anymore.");
    await db.dayPlan.upsert({ where: { personId_date: { personId, date } }, update: { occasionId: occ.id, text: null }, create: { personId, date, occasionId: occ.id } });
  } else {
    const text = pick.text.trim().slice(0, 80);
    if (!text) throw new PlanError("Type what the plan is.");
    await db.dayPlan.upsert({ where: { personId_date: { personId, date } }, update: { occasionId: null, text }, create: { personId, date, text } });
  }
}

import { cookies } from "next/headers";
import { requirePerson, isAdmin } from "@/lib/auth/current";
import { resolveView, VIEW_COOKIE } from "@/lib/people/visibility";
import { loadTodayContext } from "@/lib/today/context";
import { canDress, getSuggestion, type Suggestion } from "@/lib/outfits/engine";
import { loadCandidates } from "@/lib/outfits/catalog";
import { countCleanOut } from "@/lib/outfits/cleanout";
import { unratedRecentFit } from "@/lib/fits/service";
import { tryOnState, hasBackPhoto, mirrorEngines } from "@/lib/tryon";
import { mirrorWardrobe } from "@/lib/tryon/wardrobe";
import { isMannequinConfigured } from "@/lib/tryon/mannequin";
import { getScales } from "@/lib/checkins/service";
import { listEntries } from "@/lib/lists/service";
import { getConnection, isGoogleConfigured } from "@/lib/plans/google";
import { monoDate } from "@/lib/dates";
import { planLine } from "@/lib/plans";
import { newMatchCount } from "@/lib/shop/wants";
import { TodayScreen } from "./today-screen";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

/** Screen 04. Looks belong to the person in the switcher (Family → yourself); only they or a parent can wear/swap. */
export default async function TodayPage() {
  const me = await requirePerson();
  const view = await resolveView(me, (await cookies()).get(VIEW_COOKIE)?.value);
  const personId = view.kind === "person" ? view.personId : me.id;
  const [ctx, dress, cand, scales, occasions, cleanOut, calendar] = await Promise.all([
    loadTodayContext(me, personId), canDress(me, personId), loadCandidates(personId), getScales(), listEntries("occasion"), countCleanOut(personId),
    getConnection(personId),
  ]);
  const [unrated, tryOn, lookingFor, wardrobe, engines] = await Promise.all([dress ? unratedRecentFit(personId, ctx.date) : null, tryOnState(me, personId), newMatchCount(me, personId), mirrorWardrobe(personId), mirrorEngines()]);
  const enough = cand.usable.length + cand.restingIds.length >= 2;
  // The page never builds looks itself (Claude takes 20 to 40 seconds and a phone gives up on a load that long):
  // it shows what exists, and the screen asks for the day's looks in the background when there are none yet.
  let suggestion: Suggestion | null = null;
  try {
    suggestion = enough ? await getSuggestion(personId, ctx.date) : null;
  } catch (e) {
    console.error("looks", e);
  }
  const needsLooks = enough && dress && !suggestion;
  const person = personId === me.id ? me : await (await import("@/lib/db")).db.person.findUniqueOrThrow({ where: { id: personId } });
  const context = planLine(ctx.plan, ctx.tz) ?? "NO PLANS · EVERYDAY";
  return (
    <TodayScreen
      personId={personId}
      personName={person.name.split(" ")[0]}
      mine={personId === me.id}
      canDress={dress}
      isAdmin={isAdmin(me)}
      date={ctx.date}
      evening={ctx.hour >= 16}
      contextLine={context}
      dateLabel={monoDate(ctx.date)}
      weather={ctx.weather ? { condition: ctx.weather.condition, source: ctx.weather.source, nowF: ctx.weather.nowF, tonightF: ctx.weather.tonightF, highF: ctx.weather.highF, lowF: ctx.weather.lowF, rainChance: ctx.weather.rainChance } : null}
      weatherNote={ctx.weatherNote}
      savedZip={ctx.savedZip}
      plan={{ source: ctx.plan.source, label: ctx.plan.label, occasionId: ctx.plan.occasionId }}
      calendarConnected={Boolean(calendar)}
      calendarConfigured={isGoogleConfigured()}
      checkIn={ctx.checkIn ? { source: ctx.checkIn.source, answers: ctx.checkIn.answers.map((a) => ({ scaleId: a.scaleId, optionId: a.optionId })) } : null}
      scales={scales}
      occasions={occasions.map((o) => ({ id: o.id, name: o.name }))}
      suggestion={suggestion ? { id: suggestion.id, boards: suggestion.boards, wornIndex: suggestion.wornIndex } : null}
      needsLooks={needsLooks}
      enoughClothes={enough}
      cleanOutCount={cleanOut}
      lookingForNew={lookingFor.newMatches}
      unrated={unrated}
      tryOn={tryOn}
      mannequin={dress && tryOn !== "ready" && isMannequinConfigured()}
      backPhoto={tryOn === "ready" && (await hasBackPhoto(personId))}
      mannequinAvailable={dress && isMannequinConfigured()}
      wardrobe={wardrobe}
      engine={engines.engines[0] ?? "google"}
    />
  );
}

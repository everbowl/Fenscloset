import { cookies } from "next/headers";
import { requirePerson, isAdmin } from "@/lib/auth/current";
import { resolveView, VIEW_COOKIE } from "@/lib/people/visibility";
import { loadTodayBase } from "@/lib/today/context";
import { loadWeather, type WeatherSlice } from "@/lib/today/weather";
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
import { addDays, monoDate } from "@/lib/dates";
import { listMonth } from "@/lib/fits/service";
import { planLine } from "@/lib/plans";
import { newMatchCount } from "@/lib/shop/wants";
import { TodayScreen, type WeatherView, type WeekDay } from "./today-screen";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

/** What the screen's weather cell gets: the numbers it shows, or the reason there are none. */
function asWeatherView({ weather: w, weatherNote }: WeatherSlice): WeatherView {
  return { weather: w ? { condition: w.condition, source: w.source, nowF: w.nowF, tonightF: w.tonightF, highF: w.highF, lowF: w.lowF, rainChance: w.rainChance } : null, note: weatherNote };
}

/** The last six days and today for the week strip: the fit worn each day (its first piece's picture, or the fit's own photo). */
async function weekOf(me: { id: string; role: "admin" | "member" | "minor" }, personId: string, today: string): Promise<WeekDay[]> {
  const keys = [-6, -5, -4, -3, -2, -1, 0].map((n) => addDays(today, n));
  const months = [...new Set(keys.map((k) => k.slice(0, 7)))];
  const fits = (await Promise.all(months.map((m) => { const [y, mm] = m.split("-").map(Number); return listMonth(me, { kind: "person", personId, name: "" }, y, mm - 1); }))).flat();
  const worn = new Map(fits.map((f) => [f.date, f]));
  return keys.map((key) => {
    const f = worn.get(key);
    const d = new Date(`${key}T00:00:00Z`);
    return { key, weekday: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }), day: d.getUTCDate(), today: key === today, thumbKey: f?.thumbKey ?? f?.photoKey ?? null, fitId: f?.fitId ?? null };
  });
}

/** Screen 04. Looks belong to the person in the switcher (Family → yourself); only they or a parent can wear/swap. */
export default async function TodayPage() {
  const me = await requirePerson();
  const view = await resolveView(me, (await cookies()).get(VIEW_COOKIE)?.value);
  const personId = view.kind === "person" ? view.personId : me.id;
  const ctx = await loadTodayBase(me, personId);
  // The weather is the one outside call on this screen, so the page never waits for it: the promise is handed to the
  // screen and streams in after the paint (21 Nov 2026: a slow minute for Open-Meteo was a slow minute for the whole
  // screen). With nowhere to ask about, the answer is already in hand and nothing streams.
  const weather: WeatherView | Promise<WeatherView> = ctx.loc || ctx.savedZip ? loadWeather(ctx).then(asWeatherView) : { weather: null, note: "none" };
  const [dress, cand, scales, occasions, cleanOut, calendar, week] = await Promise.all([
    canDress(me, personId), loadCandidates(personId), getScales(), listEntries("occasion"), countCleanOut(personId), getConnection(personId), weekOf(me, personId, ctx.date),
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
      hour={ctx.hour}
      week={week}
      contextLine={context}
      dateLabel={monoDate(ctx.date)}
      weather={weather}
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

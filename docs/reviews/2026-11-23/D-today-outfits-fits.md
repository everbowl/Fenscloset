# Review D — Today / looks / outfits / weather / plans / fits / together

Scope: `src/lib/outfits/**`, `src/lib/today/**`, `src/lib/fits/**`, `src/lib/checkins/**`, `src/lib/plans/**`, `src/lib/weather/**`, `src/lib/jobs.ts`, `src/lib/ai/**`, `src/lib/dates.ts`, `src/app/(app)/today/**` (incl. `together/`), `src/app/(app)/fits/**`, the tests named in the brief, and the eight Prisma models. Every line of every file was read (counts at the end). `src/app/(app)/today/page.tsx` and `today-screen.tsx` changed on disk mid-review (uncommitted v2 redesign: greeting, week strip, flat-lay stage, wait card); line numbers below are for the **current on-disk versions**. No file was edited.

Severity key: **breaks** (a family member hits a wall), **wrong** (does the wrong thing quietly), **slow**, **unsafe**, **dead-end** (a tap with no feedback), **dead-code**.

---

## 0. The headline: why the demo took 20–40 s with only a counter

1. **Two sequential Claude generations per build, nothing saved until both finish.** `src/lib/outfits/engine.ts:160-186` drafts `count + 2 = 5` looks at `effort: "medium"` (`maxTokens: 3200`), then `rankVisually` (`:125-157`) makes a *second* `effort: "medium"` call carrying every piece photo of every drafted look (`:136` sends a piece once per look it appears in, so 15–25 images for ~8–10 distinct pieces). Only after both does `generateSuggestion` write the row (`:236`). On Claude Opus 5.5 thinking is always on, so "medium" is the time. Each call is 10–20 s → 20–40 s before the first board exists.
2. **The job never reports a step.** `src/app/(app)/today/actions.ts:95,110` pass `async () => {…}` and ignore the `step` callback that `startJob` offers; `LooksResult` (`:18`) has no `step`/`startedAt` (compare the mirror's `src/app/(app)/mirror/actions.ts:32,47`). So the screen can only show seconds (`today-screen.tsx:347-357`) and a static "Considering the weather…" (`:315`).
3. **The action itself blocks before the job starts.** `regenerateAction`/`moreAction` `await loadTodayContext()` (`actions.ts:94,109`) — that includes the weather fetch (3–12 s when Open-Meteo is slow and the cache is empty) and the Google Calendar lookup (10 s timeout per call, see §5) — *before* `startJob` and before the 1.5 s `settled` window.

**Fix (one-then-two, first look in ~10 s):** inside the job, `step("Checking the weather…")` and load the weather there; run the text pass at `effort: "low"` for **one** look with `visual: false`, `create` the row and `step("First look ready")` (the screen can `router.refresh()` on a `partial` flag and show board 1); then draft two more with `excludeBoards`, run the vision pass over those, and `update` the row. Alternatively keep the 5-look draft but save the top 3 by text order immediately and let the vision pass re-order/re-reason in place. Either way: return `step` from `looksStatusAction`, and log `usage`/latency per call (see §1.4) so the 20–40 s can be measured rather than guessed.

Cost per build today (Opus 5.5, $4/$20 per MTok): draft ≈ 4–6k input (≈45 tokens per catalog line × 80 pieces + system + style/taste) + 1.5–3k output incl. thinking ≈ $0.07; rank ≈ 20 thumbs (≤400 px, ≈250 tokens each ≈ 5k) + 1k text + ~1k output ≈ $0.04; **≈ $0.10–0.15 per build**, and every check-in or plan change triggers another full build (`saveThenRefresh` → `regenerateAction(…, true)`). Swap/remove ≈ $0.02, selfie ≈ $0.01, Together ≈ $0.10. Not a cost problem; a latency one.

---

## 1. Claude calls — `src/lib/ai/claude.ts` (74 lines)

| # | Where | Sev | What happens | Path | Fix |
|---|---|---|---|---|---|
| 1.1 | `claude.ts:19` | slow / dead-end | `new Anthropic({ apiKey, maxRetries: 2 })` with **no `timeout`**: the SDK default is 10 min per attempt, retried up to 3× on 408/429/5xx/connection errors, so one hung request can hold a looks job for ~30 min while the screen polls every 2 s (`today-screen.tsx:111-115`) and "Try again" does nothing (§7.2). | Open Today while Anthropic is degraded. | `timeout: 60_000` (per call), keep `maxRetries: 2`; let the job fail with a real error so the wait card can offer a working retry. |
| 1.2 | `claude.ts:58-63` | wrong + slow | `stop_reason === "max_tokens"` is never checked. Thinking tokens are output tokens and count toward `max_tokens`; callers pass tight caps: selfie 300 (`checkins/service.ts:93`), remove 600 (`engine.ts:315`), swap 700 (`:284`), rank 800 with 20 images (`:144`), together 1500 (`together.ts:73`), draft 3200 (`:178`). A truncated answer is truncated JSON → `parseJsonLoose` fails → `structured(req, true)` **silently repeats the entire call** (double cost and time) → `bad_json` → "Couldn't build the looks. Try again." / "Something went wrong." | Any build on a busy closet; a selfie check-in. | Check `res.stop_reason`; raise caps (≥4k draft/rank, ≥1k for the small calls); don't retry a `max_tokens` stop, surface it. |
| 1.3 | `claude.ts:58` | dead-code | Refusal message is "The model declined to tag this photo." for every caller (outfits, swap, together, selfie). | Logs only. | Take the message from the caller or make it generic. |
| 1.4 | `claude.ts:45-53` | slow (observability) | `res.usage`, `stop_reason`, and wall time are discarded. Nobody can see which of the two calls is the 20 s one, or whether cache reads happen (they don't, see 1.5). | — | One `console.info` line per call: model, effort, input/output/cache tokens, ms, stop_reason. |
| 1.5 | `claude.ts:50` | dead-code | `cache_control: ephemeral` on a ~250-token system block is below the model's minimum cacheable prefix, so nothing is ever cached. Harmless. | — | Remove, or move the stable catalog text ahead of a breakpoint if caching is wanted. |
| 1.6 | `claude.ts:67-74` | dead-code | With `output_config.format = json_schema`, an `end_turn` answer is already valid JSON; `parseJsonLoose` only masks 1.2. | — | Keep as a guard, but log when it has to fall back. |
| 1.7 | `claude.ts:3,45-53` | ok | Model `claude-opus-5-5`, `output_config: { effort, format }`, `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"` are all the current shapes; `effort` is set explicitly (default would be `medium`). | | |

Model/pricing facts checked against the current API reference: Opus 5.5 $4/$20 per MTok, thinking cannot be disabled (effort is the only lever), default effort `medium`.

---

## 2. Engine — `src/lib/outfits/engine.ts` (377), `catalog.ts` (116), `taste.ts` (97), `cleanout.ts` (86)

| # | Where | Sev | What happens | Path | Fix |
|---|---|---|---|---|---|
| 2.1 | `engine.ts:160-186, 125-157, 236` | slow | See §0.1: two sequential medium-effort calls, duplicate images per look, nothing saved until the end. | Every first open of the day. | §0 fix; de-duplicate images (`Piece 3 (Looks 1, 4)`), `effort: "low"` for the draft. |
| 2.2 | `engine.ts:236` + `:194-205` | wrong | `generateSuggestion` always **creates a new row**; `view()` matches fits by `outfitSuggestionId: row.id` (`:197`). After a check-in or plan change on a day the person already tapped **Wear this**, the new row has no fits → "✓ Wearing this" disappears and "Wear this" is back; tapping it replaces the day's fit silently. | Wear a look at 8 AM, change the plan at noon. | Match fits by `(personId, date)` in `view()` (or update the existing row); or skip the rebuild when a fit exists and say so. |
| 2.3 | `engine.ts:349-376` `wearItems:373` | wrong | Saving a fit for a **past** day (Fits → "Save the fit" on Tuesday) sets `lastWornAt: now` because `last.wornOn > date` is false. The piece rests for `noRepeatDays` from *today*, `describe()` says "last 0d ago", clean-out is wrong. | Backfill last Saturday's outfit on Fits. | When `date < today`, set `lastWornAt` to local noon of `date` in the household tz. |
| 2.4 | `engine.ts:364`, `fits/service.ts:138` | wrong | Undo/replace sets `lastWornAt: fromDayKey(prev.wornOn)` = **UTC midnight**; `dayKey(that, "America/Los_Angeles")` is the *previous* day. Resting window and clean-out off by one after any Undo or second Wear. | Tap Undo, or Wear a second look. | Same local-noon helper; one `wornDateToInstant(key, tz)` in `dates.ts`. |
| 2.5 | `engine.ts:355-376` | slow / unsafe | Interactive transaction with 2 queries per piece in two loops (`:362-365`, `:371-374`): ~20 round trips for a 5-piece look inside Prisma's default 5 s interactive-transaction window; on a slow Railway Postgres → P2028 → "Something went wrong." | Wear this on a slow evening. | Batch: one `findMany` for last wears grouped by item, `updateMany`/`$executeRaw`, or raise `timeout` on the transaction. |
| 2.6 | `engine.ts:229,233` | slow | `styleContext(personId)` and `loadCandidates` are each run twice on the small-closet fallback. | Small closet. | Reuse the first result. |
| 2.7 | `engine.ts:253` | wrong (minor) | `moreLooks` records "passed" **before** composing; if Claude fails, the passes are still written and taste memory learns from looks the person never rejected. | More looks during an API blip. | Record after success. |
| 2.8 | `engine.ts:338-347` | wrong (minor) | `wearBoard` never checks `row.date` is today; a Today left open past midnight wears yesterday's board with today's title ("Tonight's look"). | Phone left on Today overnight. | Compare `row.date` with `ctx.date`; refresh if stale. |
| 2.9 | `engine.ts:271` | dead-end (wording) | "Nothing else clean in that category today." when the alternatives are clean but *resting*. | Swap shoes with 2 pairs, one worn yesterday. | Say "resting (worn recently)" and offer to include them. |
| 2.10 | `catalog.ts:63-74` | slow | `getRuleNumber`, `findMany`, `getTimezone` awaited in series (3 round trips), and `loadCandidates` runs 2–4× per build (page `:54`, job, fallback, swap/remove). | Every page and build. | `Promise.all` the rule/tz reads; pass the tz in. |
| 2.11 | `catalog.ts:106-114` | slow | `inspirationContext` then `tasteContext` in series. | Every build. | `Promise.all`. |
| 2.12 | `cleanout.ts:34` | wrong (minor) | `since.toISOString().slice(0,10)` is a UTC day, compared to `wornOn` household-tz keys. | Late-evening wears near the 90-day edge. | `dayKey(since, tz)`. |
| 2.13 | `taste.ts` | ok | Logic correct; `recordPassed`'s `seen.add` inside `filter` (`:29`) is clever but fine. `tasteLines` is O(n²) over small n. | | |

Resting logic (`catalog.ts:72-85`) is right: worn-today pieces are not resting, stacks rest only when wears ≥ copies, `dayKey(lastWornAt, tz) !== today` — except for the instants written by 2.3/2.4.

---

## 3. Jobs — `src/lib/jobs.ts` (75)

| # | Where | Sev | What happens | Fix |
|---|---|---|---|---|
| 3.1 | `jobs.ts:33-52` | ok | Join-by-key, `after` (follow, don't join), owner check, `KEEP_MS` cleanup with `unref`, `settled` racing a timer — all correct and covered by `tests/jobs.test.ts`. `live.promise` includes the `.then/.finally`, so the follower starts after the first job's status is set. | |
| 3.2 | `jobs.ts:9-10` | dead-end (accepted) | In-process: a Railway deploy mid-build loses the job; the poll gets `null` → "Those looks got lost on the way. Try again." and the Try-again button appears. If the row *was* written before the restart the toast is wrong but `router.refresh()` shows the looks. | Acceptable; mention "deploys cancel builds" in ops notes. |
| 3.3 | `actions.ts:95,110` vs `jobs.ts:33` | slow / dead-end | `step` is never called for looks (§0.2). | Pass it through and return it in `LooksResult`. |
| 3.4 | `jobs.ts:35` + `today-screen.tsx:354,323` | dead-end | A plain `startJob(key)` **joins** the running job, so the wait card's "Try again" (`today-screen.tsx:354`) after 90 s re-joins the stuck job: nothing restarts, the counter is not reset (`buildStartedAt` only clears when `busy` leaves "regen", `:191-194`). | Pass `after: true` for the retry (or add a `restart` option that abandons the key) and reset the counter. |
| 3.5 | `jobs.ts:23` | wrong (minor) | `KEEP_MS` = 10 min: a phone back after 10 min gets "lost on the way" though the looks exist. | Have `looksStatusAction` fall back to `getSuggestion(date)` when the job is gone. |

---

## 4. Today actions — `src/app/(app)/today/actions.ts` (157)

| # | Where | Sev | What happens | Path | Fix |
|---|---|---|---|---|---|
| 4.1 | `actions.ts:140-149` + `today-screen.tsx:361,593` + `next.config.ts` | **breaks** + dead-end | The selfie `File` is sent raw inside `FormData` to a **server action**. `next.config.ts` sets no `serverActions.bodySizeLimit`, so Next's default **1 MB** applies; an iPhone selfie is 2–4 MB → rejected before the action runs. The client (`saveThenRefresh`, `today-screen.tsx:144`) has **no try/catch**, the sheet is already closed (`:142`), `busy` is "regen" → the wait card counts up **forever**, every button is disabled, no error. | Tap Check-in → Take a selfie → shoot. | Shrink on the client (`shrinkPhoto(file, 1280)` from `src/lib/import/client-queue.ts`, already used by Fits) or upload via `/api/uploads/sign` and pass the key; set `bodySizeLimit`; wrap `fn()` in try/catch (§7.1). |
| 4.2 | `actions.ts:56-63` vs `page.tsx:83` | wrong + dead-end | `setZipAction` saves to **`me.id`**, but the screen shows and asks for the **viewed person's** zip (`savedZip={ctx.savedZip}` of `personId`). A parent on a child's Today enters a zip → "✓" → the chip still says "Enter zip"; loops forever. | Parent dressing a minor; no location cookie. | Take `personId`, `assertCanDress`, save to that person. |
| 4.3 | `actions.ts:68-71,76,81,127,135,146` | slow | `wearAction`, `swapAction`, `removeAction`, `setPlanAction`, `checkInTapsAction`, `checkInSelfieAction` all call `loadTodayContext` (weather + calendar) when they only need `date`/`hour`/`plan`. On a bad Open-Meteo day a "Save check-in" tap waits 3–12 s before saving. | Any tap while Open-Meteo or Google is slow. | `loadTodayBase` for those; weather only where the engine runs (and inside the job, §0.3). |
| 4.4 | `actions.ts:94,109` | slow | Weather and calendar awaited **before** `startJob` (§0.3). | First open. | Move into the job with a `step`. |
| 4.5 | `actions.ts:23-27` | dead-end | `AiError` (`no_key`, `api`, `refusal`, `bad_json`) → "Couldn't build the looks. Try again." With `ANTHROPIC_API_KEY` unset the family sees this forever and the admin gets no hint. | Fresh deploy / rotated key. | Map `no_key` → "Looks aren't set up yet (no AI key)."; log the AiError code. |
| 4.6 | `actions.ts:116-121` | slow | `looksStatusAction` returns only ok/pending (§0.2); also runs `requirePerson()` (a DB read) every 2 s per phone. | — | Return `step`/`startedAt`; poll at 2 s then back off to 4 s after 30 s. |
| 4.7 | `actions.ts:48-54` | ok | Location cookie: `httpOnly`, `lax`, 12 h, 3-decimal rounding. | | |

---

## 5. Context, weather, plans, Google — `src/lib/today/*`, `src/lib/weather/index.ts`, `src/lib/plans/*`

| # | Where | Sev | What happens | Path | Fix |
|---|---|---|---|---|---|
| 5.1 | `today/context.ts:37-42` → `plans/index.ts:31-36` → `plans/google.ts:119-154` | **slow** | **Google Calendar is still on the page's critical path** (the same shape as the fixed 17 s weather). `loadTodayBase` awaits `getPlan`; `nextEventToday` does a token refresh (`:134`, 10 s timeout) and one fetch **per calendar, sequentially** (`:138-142`, 10 s each); failures are **not cached** (only successes, `:128-133`). When Google is slow or the refresh token is revoked, Today blocks up to 10–30 s before paint, on **every** load and every action in 4.3. Hidden in tests by `MOCK_GOOGLE`. | Anyone with Calendar connected, on a slow Google day — or forever after revoking access. | Stream the plan like the weather (promise + Suspense), cache failures for 10 min, `Promise.all` the calendars. |
| 5.2 | `plans/google.ts:111-114,134` + `plans/index.ts:34-36` | wrong + dead-end | Revoked/expired refresh token → `tokenRequest` throws `invalid_grant` → `getPlan` logs and returns `none`. The screen says "Nothing on your calendar today" with `calendarConnected` true (`today-screen.tsx:365`); nobody is ever told to reconnect; Settings presumably still shows connected. | Remove the app in Google permissions, or 6 months of inactivity (Google expires unused refresh tokens). | On `invalid_grant`, mark the connection broken (column) and show "Calendar needs reconnecting →" on Today and Settings. |
| 5.3 | `weather/index.ts:64-70` + `:159-179` | wrong | Stale fallback (up to **24 h**) is presented as current: `summarize` takes `today` from the stale `current.time` (`:163`), so "68° now", "61° tonight", H/L and rain are **yesterday's** numbers; `Weather` has no `fetchedAt`/stale flag, so neither the chip (`today-screen.tsx:446-461`) nor the prompt (`engine.ts:85`) can say so. | Open-Meteo down this morning; yesterday's forecast cached. | Carry `fetchedAt`; show "as of 9 AM yesterday"; past ~6 h fall to `weatherNote: "failed"` and let the prompt say "unknown". |
| 5.4 | `weather/index.ts:60-76` | ok | Cache / failure memo (2 min) / stale-quick path (3 s) / patient (6 s + one retry) — correct and tested. In-memory `failures` is per process (fine). | | |
| 5.5 | `plans/google.ts:147,150` | wrong (fragile) | All-day start `new Date(`${date}T00:00:00`)` is **server-local**; `toISOString().slice(0,10) === day` is right only when the server runs UTC or west of it. | Server tz east of UTC. | Build from `dayKey` directly; never parse all-day dates as instants. |
| 5.6 | `plans/google.ts:131,153` | wrong (design) | `find(e => e.allDay || e.start >= now)`: an all-day "Thanksgiving" always beats a 7:30 PM dinner. | Any holiday with an evening plan. | Prefer the next timed event; fall back to all-day. |
| 5.7 | `plans/google.ts:96,108,128,152` | dead-code (hygiene) | Calendar events cached in `WeatherCache` under `gcal:` keys; rows accumulate one per person per day forever. | — | Nightly prune or a `CalendarCache` table with TTL. |
| 5.8 | `today/weather.ts` | ok | Never throws; location-cookie-then-zip order; tested. | | |
| 5.9 | `dates.ts:44-46` | wrong (minor) | `isValidDayKey("2026-13-45")` is `true` (Date.UTC rolls over) → `/fits?d=2026-13-45` renders a garbage month. | Hand-edited URL. | Round-trip: `fromDayKey(key)` → `toISOString().slice(0,10) === key`. |
| 5.10 | `dates.ts:11-14` | ok | `hourIn` handles the "24" quirk with `% 24`. `dayKey`/`monoDate`/`clock` tested. | | |
| 5.11 | `page.tsx:77` + `today-screen.tsx:207` | wrong (minor) | `evening = hour >= 16` ("Tonight's looks") but the greeting says "Good afternoon" until 17:00 → 4–5 PM reads "Good afternoon … Building tonight's looks". | 4 PM. | One threshold. |

---

## 6. Check-ins and fits — `src/lib/checkins/service.ts` (99), `src/lib/fits/service.ts` (149), `src/app/(app)/fits/**`

| # | Where | Sev | What happens | Fix |
|---|---|---|---|---|
| 6.1 | `checkins/service.ts:89-93` | wrong | `maxTokens: 300` for the selfie read with thinking on (1.2). | ≥1000. |
| 6.2 | `checkins/service.ts:54` | unsafe (minor) | Old selfie deleted from storage **before** the transaction; a failing transaction leaves a row pointing at a deleted object. | Delete after commit. |
| 6.3 | `checkins/service.ts:76-78` | unsafe (minor) | `putObject` then `save`; a failed `save` orphans the object. | Delete on failure. |
| 6.4 | `fits/service.ts:138` | wrong | UTC-midnight `lastWornAt` (2.4). | Shared helper. |
| 6.5 | `fits/service.ts:133-142` | slow (minor) | S3 `deleteObject` inside the DB transaction plus a per-log loop. | Delete after commit; batch updates. |
| 6.6 | `fits/service.ts:36-45,72-75` | ok | Visibility (`visibleWhere`), minors' parents, `canEdit` via `canDress` — correct; `toView` is N+1 over a day's fits (few). | |
| 6.7 | `fits/fits-screen.tsx:52-55` | breaks / dead-end | `run()` has no try/catch → a thrown action leaves `busy` set; every button on Fits disabled (§7.1). `uploadPhoto` (`:56-70`) does catch — copy that pattern. | try/catch → `setBusy(null); toast.error(…)`. |
| 6.8 | `fits/fits-screen.tsx:146` | ok | RatingRow only for `f.date <= today`; `rateFitAction` toggles with `null`. | |
| 6.9 | `fits/page.tsx:22-23` | wrong (minor) | Accepts rolled-over day keys (5.9). | |

---

## 7. Today screen (client) — `src/app/(app)/today/today-screen.tsx` (619, current v2)

| # | Where | Sev | What happens | Path | Fix |
|---|---|---|---|---|---|
| 7.1 | `today-screen.tsx:86-94` (`run`), `:140-151` (`saveThenRefresh`); also `together-screen.tsx:37-44`, `fits-screen.tsx:52-55` | **breaks** / dead-end | `await fn()` has **no try/catch**. A server action that *throws* (iOS Safari drops the fetch when the app is backgrounded or the screen locks — "Load failed" — a 500, the 1 MB body limit in 4.1) rejects inside `startTransition`; `busy` never clears; **every button is `disabled={busy !== null}`**, "Wear this" shows "Saving…" forever, no toast. Only `buildLooks` (`:125`) catches. This is the most likely cause of "I tapped and nothing happened". | Tap Wear this, lock the phone for 10 s, unlock. | `try { r = await fn() } catch { r = { ok: false, error: "Lost the connection. Try again." } }` in all three `run`s and in `saveThenRefresh`. |
| 7.2 | `today-screen.tsx:354` (and `:323`) | dead-end | "Try again" on the slow wait card joins the same stuck job (3.4); counter keeps counting. | 90 s into a hung build. | `regenerateAction(id, true)` or a restart flag; reset `buildStartedAt`. |
| 7.3 | `today-screen.tsx:413` + `src/app/(app)/fits/` | **breaks** | Week strip links worn days to `/fits/${d.fitId}`; there is **no `fits/[fitId]` route** (Fits takes `?d=`). Every worn day in the new strip is a 404. | Tap any day with a picture in the week strip. | `href={`/fits?d=${d.key}`}`. |
| 7.4 | `today-screen.tsx:106-119` | dead-end | Polling has no ceiling: with 1.1 it runs every 2 s for up to 30 min. A session expiry inside `looksStatusAction` is swallowed by `catch { next = r }` and polled forever. | Hung Claude call. | Server-side timeout (1.1) + give up client-side at ~3 min with a real message; don't swallow auth errors. |
| 7.5 | `today-screen.tsx:374-388` | dead-end | Swap/Remove run with the sheet open; on error the sheet stays open (`after` not called) and `toast.error` renders **under the `<dialog>` top layer and its 40 % backdrop** (`globals.css:143`) — "Nothing else clean in that category today." is dim and unreachable; "Thinking…" just vanishes. | Swap when the category has one piece. | Close the sheet before the action, or show the error inside the sheet. |
| 7.6 | `today-screen.tsx:176` | wrong (iOS jank) | `goTo(indexRef.current)` runs on **every** `p.suggestion` identity change, i.e. every `router.refresh()` (rate, zip, location, mirror…): the strip snaps instantly back to the current board mid-swipe. | Rate yesterday's fit while swiping. | Depend on `boards.length` (and the suggestion id), not the object. |
| 7.7 | `today-screen.tsx:311-318, 347-357` | slow (UX) | Wait stage says "Considering the weather…" statically; wait card shows seconds only (§0.2). | Every first open. | Real steps from the job. |
| 7.8 | `today-screen.tsx:361,593` | breaks | Raw selfie through a server action (4.1). `capture="user"` also forces the camera on iOS (no "choose from library"). | | Shrink client-side; consider a second input without `capture`. |
| 7.9 | `today-screen.tsx:181-185` | dead-end (edge) | On success `run("location")` — subject to 7.1 if the fetch fails while the permission prompt had the app backgrounded. Failure path (→ zip sheet) is fine. | | 7.1 fix covers it. |
| 7.10 | `today-screen.tsx:333` | wrong (minor) | `RatingRow rating={null}` always: no "✓ Thanks" state; the card just disappears after the refresh. | Rate from Today. | Keep local state until the refresh lands. |
| 7.11 | `today-screen.tsx:219-223, 427-429` | ok | `use(promise)` inside Suspense with a server-created promise is the right React 19 pattern; `loadWeather` never rejects, so no error boundary is needed. `WeatherCredit` reuses the same promise. | | |
| 7.12 | `today-screen.tsx:244, 518, 156-168` | ok (iOS) | `.strip` (`display:flex; overflow-x:auto; -webkit-overflow-scrolling: touch`, `globals.css:158`) + `snap-x snap-mandatory`, children `w-[92%] shrink-0 snap-center`; IntersectionObserver with `root: el, threshold: 0.6`; `scrollTo({behavior:"instant"})` (iOS 15.4+). No `flex: 1 1 0%` in an auto-height column here (the Sheet already uses `flex-auto`). `<details open>` controlled works in WebKit. | | |
| 7.13 | `today-screen.tsx:261, 252-256` vs `e2e/today.spec.ts:26,63` | breaks (tests) | v2 renders "Tops" (sentence case) and dots; the e2e still asserts `toContainText("TOPS")` (case-sensitive) and `getByText("04 / 06")`. The uncommitted redesign fails `e2e/today.spec.ts`. | CI. | Update the spec (`/tops/i`, `sr-only` "4 of 6"). |
| 7.14 | `today-screen.tsx:36` + 4.2 | wrong | `savedZip` is the viewed person's; the action saves to the viewer. | | 4.2. |

---

## 8. Together — `src/lib/outfits/together.ts` (103), `today/together/*` (34 + 37 + 119)

| # | Where | Sev | What happens | Path | Fix |
|---|---|---|---|---|---|
| 8.1 | `together/actions.ts:12-24` → `together.ts:28-44` | **breaks** / slow | The whole flow runs **inside a synchronous server action**: `loadTodayContext` (weather + calendar), then per person `loadCandidates` + `styleContext`, then **one medium-effort Claude call over every piece of 2–4 closets** (`:63-80`). 15–40 s on an iPhone with only "Thinking…" — exactly the request shape the jobs helper was written to avoid; if the phone sleeps the fetch is dropped and 7.1 leaves "Dress us" stuck. Nothing is saved on failure. | Tap "Dress us" for three people. | `startJob("together|…")` + poll like Today, with steps ("Reading the owner's closet…", "Dressing you together…"). |
| 8.2 | `together.ts:75-80` + `:41` + `together-screen.tsx:111` | dead-end | "Exactly one look per person" is prompt-only. A person Claude skipped (or mapped to a name that didn't match, 8.3) gets `outfits: []` and **simply isn't on the board**; the "Nobody had enough clean pieces" line appears only when *everyone* is missing. | Three people, one small closet. | Validate the answer; re-ask for the missing person or show "No look for Casey: …" with a reason. |
| 8.3 | `together.ts:365-366, 376, 76` | wrong (edge) | `person: enum first names`; two people with the same first name → `per.find` returns the first, the second is dropped silently. | Two "the owner"s. | Key by id-coded names ("the owner (J)", "the owner (K)"). |
| 8.4 | `together.ts:36` + `together/actions.ts:15` | wrong (minor) | With no occasion picked, the **creator's** plan (their calendar event) is applied to everyone. | Dad has "Dentist 3 PM", dresses the family. | Use `source: "none"` unless a label was picked. |
| 8.5 | `together.ts:73` | wrong | `maxTokens: 1500` at medium effort for 3–4 people (1.2). | | ≥3000. |
| 8.6 | `together.ts:39-42, 89-96` | slow (minor) | Sequential `create` per person; N+1 `item.findMany` in `getTogether`. | | `createMany`; one `findMany` over all ids. |
| 8.7 | `together-screen.tsx:30-33, 191-192` | wrong (minor) | On "Change", `occasionId` starts `null` while `text` starts with the session label → re-dressing stores the occasion as free text. | Change → Dress us. | Seed `occasionId` from the session. |
| 8.8 | `together/page.tsx:20` | dead-code | Dynamic `import("@/lib/outfits/together")` for `getTogether` though the module is already statically imported (`:6`). | | Import normally. |

Authorization in Together is right: `togetherPeople` hides minors from non-parents, `createTogether` filters ids against it, `wearTogetherAction` goes through `wearBoard → assertCanDress`, `getTogether` requires membership or creator.

---

## 9. Today page (server) — `src/app/(app)/today/page.tsx` (104, current)

| # | Where | Sev | What happens | Fix |
|---|---|---|---|---|
| 9.1 | `page.tsx:48` | slow | Google on the critical path (5.1). | Stream or cache failures. |
| 9.2 | `page.tsx:45→46→48→53→56→62→67→98` | slow | Eight sequential stages: `requirePerson`, `resolveView`, `loadTodayBase`, two `Promise.all`s, `getSuggestion`, the person row (`:67`, via a dynamic `import("@/lib/db")`), and `hasBackPhoto` awaited **inside JSX** (`:98`). `loadCandidates` (`:54`) is also redone inside the job; `countCleanOut` adds two rule reads; `weekOf` (`:31-41`) adds 1–2 `listMonth` queries. Each stage is a DB round trip on Railway. | Fold `getSuggestion`, the person row and `hasBackPhoto` into the `Promise.all`s; `resolveView` can return the person. |
| 9.3 | `page.tsx:66` | ok | `needsLooks = enough && dress && !suggestion`; on a `getSuggestion` throw the client rebuilds — acceptable. | |
| 9.4 | `page.tsx:52` | ok | Weather promise handed to the client only when there is somewhere to ask; otherwise a plain value. Good. | |

---

## 10. Authorization, revalidation, optimistic UI (summary)

- **Authorization is consistent**: `assertCanDress` on wear/swap/remove/more/regenerate (`actions.ts:70,76,81,93,108`), `canTouch`/`assertCanTouch` on plans and check-ins, `assertOwnerish` on fits, `jobStatus` owner check. `setZipAction` is the one that acts on the wrong person (4.2).
- **Revalidation**: every action `revalidatePath("/today")` (+ `/fits`, `/closet`) **and** the client calls `router.refresh()` — harmless double work. The poll's `looksAnswer` revalidates on done.
- **Optimistic UI**: none; busy labels ("Saving…", "Thinking…", "✓ Worn" flash) are the feedback. Adequate once 7.1 is fixed.

---

## 11. Dead ends — every tap with no (or false) feedback

1. **Any action whose fetch throws** → `busy` stuck, all buttons disabled, no toast (`today-screen.tsx:86-94,140-151`; `fits-screen.tsx:52-55`; `together-screen.tsx:37-44`).
2. **Take a selfie** → 1 MB server-action limit → "Building today's looks · Ns" forever (`actions.ts:140-149`, `today-screen.tsx:144,361`).
3. **"Try again" on the slow wait card** → joins the same job; counter keeps going (`today-screen.tsx:354`, `jobs.ts:35`).
4. **Week strip, a day with a fit** → 404 (`today-screen.tsx:413`).
5. **Swap / Remove error with the sheet open** → toast under the dialog backdrop (`today-screen.tsx:381-383`, `globals.css:143`).
6. **Zip entered on someone else's Today** → saved to the viewer; chip still says "Enter zip" (`actions.ts:56-63`).
7. **Together: a person Claude skipped** → no board, no message (`together.ts:75-80`, `together-screen.tsx:111`).
8. **Together "Dress us" when the phone sleeps mid-request** → "Thinking…" then nothing, no retry (`together/actions.ts:12-24`).
9. **Calendar connected but revoked** → "Nothing on your calendar today" forever (`plans/google.ts:134`, `plans/index.ts:34-36`).
10. **No `ANTHROPIC_API_KEY`** → "Couldn't build the looks. Try again." forever (`actions.ts:23-27`).
11. **Poll after a restart / after 10 min** → "lost on the way" toast even when the looks exist (`jobs.ts:23,46`).
12. **Rate from Today** → card disappears with no "✓ Thanks" (`today-screen.tsx:333`) — minor.

---

## 12. What the tests do and do not cover

- `tests/jobs.test.ts` (47): join, `after`, owner, quick settle, failure — good. Not: restart loss, polling ceiling, step reporting.
- `tests/outfits/engine.test.ts` (143), `taste.test.ts` (59): filters, resting, fallback-to-resting, wear/replace/undo counts, swap/remove, more, together authorization, taste lines — all under `MOCK_AI`, so `composeLooks`/`rankVisually`/`structured` prompt and schema paths are **never executed**; `rankVisually` is tested only for the no-photo short-circuit. No test for past-date `lastWornAt` (2.3) or the UTC-midnight instant (2.4) — the existing assertion `lastWornAt: null` after undo passes by accident.
- `tests/weather/weather.test.ts` (85), `today-weather.test.ts` (69): summarize, cache, failure memo, stale fallback, quick path, location-cookie order, never-throws — good. No assertion that a stale forecast's "now" is yesterday (5.3).
- `tests/plans/plans.test.ts` (50): `MOCK_GOOGLE` only — token refresh, revoked token, per-calendar fetch, all-day handling, event cache are untested.
- `tests/checkins/service.test.ts` (43), `tests/fits/service.test.ts` (57), `rating.test.ts` (35): authorization and basic flows — good.
- **No test touches `src/lib/ai/claude.ts`** (`structured`, `parseJsonLoose`, refusal, `max_tokens`, retries, timeout).
- `tests/outfits/{fashn,kling,mannequin,tryon,complete,styling,wardrobe,google-filters}.test.ts` (107+134+69+263+53+71+36+93) test `src/lib/tryon/**` (the mirror), not the outfit engine.
- `e2e/today.spec.ts` (139): with `MOCK_AI` builds finish inside the 1.5 s window, so the **`pending`/poll path, the wait card, the slow "Try again", a failed build, the weather "failed" note, "Use my location", the Swap error path, and the week strip are never exercised**; the Together flow is exercised only in the instant mock. It is **stale against the uncommitted v2 screen** (`:26` "TOPS", `:63` "04 / 06").

---

## 13. Prisma models (read: OutfitSuggestion, Fit, FitItem, WearLog, CheckIn, CheckInAnswer, DayPlan, TogetherSession, TogetherPerson, WeatherCache, GoogleCalendarConnection, LookFeedback)

- `OutfitSuggestion` has `@@index([personId, date])` and rows are append-only per day (2.2); fine for reads, but nothing prunes superseded rows.
- `WearLog.fitId` `onDelete: SetNull` while `deleteFit` deletes logs explicitly — consistent. `Fit.outfitSuggestionId` `SetNull` — consistent with 2.2's symptom.
- `WeatherCache` doubles as the calendar cache (5.7). `GoogleCalendarConnection` has no "broken/needs reconnect" column (5.2).
- `CheckIn @@unique([personId, date])`, `DayPlan @@id([personId, date])` — the upserts rely on these correctly.

---

## Files read (line counts)

| File | Lines |
|---|---|
| src/lib/ai/claude.ts | 74 |
| src/lib/ai/read-label.ts | 26 |
| src/lib/ai/same-garment.ts | 26 |
| src/lib/ai/tag-item.ts | 180 |
| src/lib/jobs.ts | 75 |
| src/lib/dates.ts | 51 |
| src/lib/outfits/engine.ts | 377 |
| src/lib/outfits/catalog.ts | 116 |
| src/lib/outfits/cleanout.ts | 86 |
| src/lib/outfits/taste.ts | 97 |
| src/lib/outfits/together.ts | 103 |
| src/lib/today/context.ts | 50 |
| src/lib/today/weather.ts | 31 |
| src/lib/weather/index.ts | 185 |
| src/lib/plans/index.ts | 60 |
| src/lib/plans/google.ts | 154 |
| src/lib/checkins/service.ts | 99 |
| src/lib/fits/service.ts | 149 |
| src/app/(app)/today/page.tsx | 104 (current; 88 in HEAD) |
| src/app/(app)/today/actions.ts | 157 |
| src/app/(app)/today/today-screen.tsx | 619 (current; 598 in HEAD) |
| src/app/(app)/today/together/page.tsx | 34 |
| src/app/(app)/today/together/actions.ts | 37 |
| src/app/(app)/today/together/together-screen.tsx | 119 |
| src/app/(app)/fits/page.tsx | 48 |
| src/app/(app)/fits/actions.ts | 32 |
| src/app/(app)/fits/rating-row.tsx | 23 |
| src/app/(app)/fits/fits-screen.tsx | 209 |
| tests/jobs.test.ts | 47 |
| tests/outfits/engine.test.ts | 143 |
| tests/outfits/taste.test.ts | 59 |
| tests/outfits/complete.test.ts | 53 |
| tests/outfits/styling.test.ts | 71 |
| tests/outfits/wardrobe.test.ts | 36 |
| tests/outfits/google-filters.test.ts | 93 |
| tests/outfits/fashn.test.ts | 107 |
| tests/outfits/kling.test.ts | 134 |
| tests/outfits/mannequin.test.ts | 69 |
| tests/outfits/tryon.test.ts | 263 |
| tests/weather/weather.test.ts | 85 |
| tests/weather/today-weather.test.ts | 69 |
| tests/fits/service.test.ts | 57 |
| tests/fits/rating.test.ts | 35 |
| tests/checkins/service.test.ts | 43 |
| tests/plans/plans.test.ts | 50 |
| e2e/today.spec.ts | 139 |
| prisma/schema.prisma (models listed in §13) | excerpts |

Supporting files consulted for callers/behaviour (not fully reviewed): `src/lib/rules.ts` (69), `src/components/ui/sheet.tsx` (51), `src/components/ui/toast.tsx` (42), `src/components/ui/button.tsx` (head), `src/components/items/row-editor.tsx` (TextSheet), `src/lib/images/thumb.ts` (head), `src/lib/storage.ts` (IMAGE_TYPES), `src/lib/db.ts` (15), `src/app/globals.css` (sheet/strip/wait/pill rules), `next.config.ts` (16), `playwright.config.ts` (env), `src/app/(app)/mirror/actions.ts` (step reporting, for comparison), `package.json` (`@anthropic-ai/sdk` ^0.135.0, Next 16.4.6, React 19.3.0, Prisma 7.10.1).

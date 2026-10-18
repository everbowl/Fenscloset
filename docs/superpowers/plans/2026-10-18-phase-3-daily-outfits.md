# Phase 3: Daily Outfits & Wear Tracking — Implementation Plan

**Goal:** Every morning (or evening) a person opens Today and gets three looks built from their own closet, for the real weather and the real plan, with one tap to wear it. Wearing logs the pieces, fills the Fits calendar, and feeds the no-repeat and clean-out rules. Together mode dresses two or more people for the same plan.

**Spec:** `docs/PLAN.md` §3 Daily, §4 screens 5–6 and Fits, Phase 3. Drawn screens: 04 Today and 05 Fit Calendar (pixel-match). Undrawn: Check-in, Together mode, Swap, Clean-out (build from DESIGN.md components; screenshot batch for approval).

## Global constraints
- Nothing hard-wired: check-in scales/options, occasions, rules (`noRepeatDays`, `notWornMonths`) are editable lists/rules with inline EDIT where used.
- Suggestions only ever use pieces the person may wear: own items plus Family-closet items; never `neverSuggest`, never `dirty`/`cleaners`, never retired, never worn inside the no-repeat window (unless nothing else fits, then say so in the reason).
- Body data never leaves the family: check-in selfies are stored under `checkins/<ownerId>/…` and viewable by the owner only (parents too for a minor). They are sent to Claude only to read tan/hair/skin, never stored elsewhere.
- Fit photos are visible to the people tagged on the fit; the visibility line always says who. A minor's fits are visible to the minor and parents plus anyone the parent tags.
- All keys in env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Google Calendar). Weather (Open-Meteo) and zip lookup (Zippopotam.us) need no key. `MOCK_WEATHER=true` and `MOCK_AI=true` give canned results for tests.
- Weather attribution "Weather by Open-Meteo" appears under the context line (their license requires it).

## Assumptions flagged for Jeff (built this way unless he says otherwise)
- A1. Outfit generation is text-only: Claude gets the catalog as tags (name, category, colors, fabric, seasons, formality, occasions, wear history), not photos. Keeps a 3-look set near $0.05. Photos are shown on the board from our cutouts.
- A2. A "fit" is a new record (`Fit`) created when WEAR THIS is tapped (today) or SAVE THE FIT is tapped on the Fits screen (any day). The Fits calendar reads fits, not the raw wear log.
- A3. Location order: browser location (if the phone allows it) → saved zip → ask for a zip right on Today (saved for next time).
- A4. SWAP ONE PIECE: tap the piece on the board to replace, Claude proposes one replacement from the closet with a new reason. MORE LOOKS: three new looks that exclude the ones already shown.
- A5. Clean-out: an item not worn for `notWornMonths` (or never worn and added that long ago) appears on `/closet/clean-out` with KEEP (snooze 3 months), DONATE, SELL. Donate/Sell retire the item (hidden from the closet and suggestions, kept in history). Today shows a rule-bounded strip with the count.
- A6. Together mode shows one board per person stacked (phone is one column), each with its own WEAR THIS.

## Tasks
1. **Schema + lists**: `CheckIn {personId, date, source taps|selfie, selfieKey?, answers CheckInAnswer[]}` with `CheckInAnswer {checkInId, scaleId, optionId}`; `OutfitSuggestion {personId, date, inputs Json, outfits Json, togetherSessionId?, wornOutfitIndex?}`; `TogetherSession {mode coordinate|match|contrast, occasionId?, occasionText?, createdById, people}`; `WearLog {personId, itemId, wornOn, fitId?}`; `Fit {personId, date, title, occasionId?, photoKey?, items FitItem[], viewers FitViewer[]}`; `GoogleCalendarConnection {personId, refreshToken (encrypted), email, calendarIds[]}`; `WeatherCache {key, payload, fetchedAt}`; `Item.retiredAt`, `Item.retiredReason`, `Item.cleanOutSnoozedUntil`. Storage kinds `checkins`, `fits`. Migration via `npm run db:new-migration`.
2. **Weather + location** (`src/lib/weather/`): zip → lat/lon (Zippopotam, cached), lat/lon → today's hourly/daily (Open-Meteo, cached 1h), "68° NOW → 61° TONIGHT" formatter. Tests with mock.
3. **Plans / occasion** (`src/lib/plans/`): Google OAuth connect/disconnect + token refresh + next event today; occasion override stored on the day's `OutfitSuggestion.inputs`. Settings row "Google Calendar" (CONNECT / DISCONNECT; "Not set up yet" until env vars exist). Occasion picker uses the editable `Occasion` list with inline EDIT.
4. **Check-in** (`src/lib/checkins/`): save taps; selfie → Claude maps to the options of each scale → saved with `source: selfie`. Sheet from the CHECK-IN header link: one row per scale with the options as pills, or TAKE A SELFIE. Tests.
5. **Outfit engine** (`src/lib/outfits/`): candidate filter (rules above), prompt + JSON schema (3 outfits of 3–5 item ids each, hero first, piece labels, one-sentence reason), mock, persistence, swap, more. Tests: dirty and no-repeat items never appear; mock returns 3 boards.
6. **Today screen (04)**: context line (date · weather · next plan), title Today’s/Tonight’s look + counter, swipeable boards, piece list, reason, WEAR THIS → wear log + fit + confirmation; SWAP ONE PIECE; MORE LOOKS; "Going out together?" strip; clean-out strip when due; zip ask when no location.
7. **Together mode** (`/today/together`): pick people (closets the viewer may see), pick mode, pick occasion → one board per person with reason; WEAR THIS per person logs for that person (parents for minors; others only for themselves).
8. **Fits screen (05)**: month grid with fit photos, selected-day panel (date, title, SHARE, collage 2×2 photo + item tiles, visibility line, SAVE THE FIT / ADD PHOTO). Family view shows fits visible to the viewer. Photo upload reuses the signed upload path.
9. **Clean-out**: `/closet/clean-out` list + actions; item detail shows "Not worn since" and wear history; closet grid hides retired items.
10. **Acceptance**: unit + e2e (morning flow for 2 people, together for 3), deploy, screenshot batch, report.

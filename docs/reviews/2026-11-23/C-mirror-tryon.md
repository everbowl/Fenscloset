# Review C — the mirror (try-on, looks, mirror UI)

Scope read line by line: src/lib/tryon/**, src/lib/looks/**, src/components/mirror/**, src/components/looks/**, src/app/(app)/mirror/**, src/app/(app)/looks/**, the four unit tests and three e2e specs named, the eight Prisma models. Dependencies read to verify claims: src/lib/jobs.ts, src/lib/images/google-image.ts, src/lib/storage.ts, src/lib/ai/claude.ts (lines 1-66), src/components/ui/sheet.tsx, src/lib/photos/visibility.ts, src/lib/people/visibility.ts (40-80), src/app/api/photo/[...key]/route.ts, the shop try-on action, addBodyPhoto, playwright.config.ts. No file was edited.

## 0. Last night's demo, traced through the code

For one fresh look of two garments (top + bottom) on the person, with the rule set to Google and the seeded styling defaults, `tryOnLook` (src/lib/tryon/index.ts) makes these outside calls, in this order, all serial:

| # | Call | Where | Needed? |
|---|------|-------|---------|
| 1 | Vertex try-on, garment 1, `safetySetting: block_none` → **400 refused** | google.ts:86-89 | wasted (known-refused) |
| 2 | Vertex try-on, garment 1, `block_only_high` (50 diffusion steps) | google.ts:87 | yes, ~15-25 s |
| 3 | Vertex try-on, garment 2, `block_none` → **400 refused** | google.ts:86-89 | wasted |
| 4 | Vertex try-on, garment 2, `block_only_high` | google.ts:87 | yes, ~15-25 s |
| 5 | Claude render check ("Checking the picture…") | index.ts:271, garment-check.ts:43 | yes, ~5-8 s, no timeout |
| 6-8 | on a fail: Gemini image "Dressing again…" with thresholds OFF → **400**, BLOCK_NONE → **400**, BLOCK_ONLY_HIGH | google-image.ts:54-71 | 2 wasted + 1 real (~10 s) |
| 9 | Claude render check again ("Checking again…") | index.ts:282 | yes |
| 10-12 | Gemini image styling pass, same three thresholds | index.ts:299, google-image.ts:54-71 | 2 wasted + 1 real |
| 13 | **`garmentImages()` again**: DB + every garment re-downloaded from S3 | index.ts:304 | wasted |
| 14 | Claude render check of the styled picture | index.ts:305 | yes |

Realistic total 80-110 s; the sheet says "Usually 20 to 60 seconds" (mirror-sheet.tsx:120). The styling pass (10-14) runs on **every** top+bottom look by default, because the seeded default options carry prompts (the test at tests/outfits/tryon.test.ts:153 asserts "Styling · … Untucked" runs with no pick). Steps 6-12 are Gemini *image edits of the person's photo*; the checks at 9 and 14 look only at the garments (garment-check.ts:24 RENDER_PROMPT), never at the face or body, so a repaint that changes the person but gets the clothes right **passes and is shown as "On you"** with no mark. That is the "it's not me" picture. "The render check failed twice" is steps 5 and 9 both returning ok=false: the try-on's own picture is then kept with the note (index.ts:284), but the styling pass still runs on it (index.ts:297-305) and its output, another repaint, is what the person sees.

## 1. Findings

Severity words: breaks | wrong | slow | unsafe | dead-end | dead-code.

### Outside calls: timeouts, retries, error paths

1. **src/lib/tryon/google.ts:74, 86-92 — slow.** `levels` always starts at `block_none`, which the project is not allowlisted for; every garment of every dressing pays a full round-trip (person + garment base64 in the body) to be refused, and the refusal is never remembered. Path: any "See it on me" with Google as the engine, or the Google column of Compare. Fix: remember the refused level in module state for the process (like `holdUntil` in google-image.ts) or ship `GOOGLE_VERTEX_TRYON_SAFETY=block_only_high` until Google approves the project.

2. **src/lib/tryon/google.ts:89 — wrong.** Any 400 on the first level is read as "safety refused" and the whole request is re-sent with the next level, so a real 400 (person not detected, image too large, bad base64) costs a guaranteed second 400 and the real reason surfaces only at line 96 as a generic `Error`, which the mirror shows as "The mirror didn't come back. Try again." (actions.ts:41). Path: a body photo Google cannot read. Fix: retry on 400 only when the response text names `safetySetting`, and map the other 400s to a `TryOnError` with Google's words.

3. **src/lib/images/google-image.ts:54, 57-71 — slow.** Relaxed mode tries OFF, then BLOCK_NONE, then BLOCK_ONLY_HIGH, then defaults; the first two are refused for an unapproved project, so the second dressing and the styling pass each pay two wasted round-trips carrying the person's full picture, and again nothing is remembered between calls. Path: every styling chip, every "Dressing again…". Fix: same memory of the working level; `GOOGLE_VERTEX_IMAGE_SAFETY=BLOCK_ONLY_HIGH` pins it today.

4. **src/lib/tryon/garment-check.ts:38, 47 → src/lib/ai/claude.ts:19 — breaks (hangs).** The Anthropic client is built with `maxRetries: 2` and **no `timeout`**; the SDK default is 10 minutes per attempt. A hung render check holds the job for up to 30 minutes; the sheet shows "Checking the picture…" with the seconds climbing and nothing on the client ever gives up (see 24). Path: a slow Anthropic region during a dressing. Fix: `new Anthropic({ timeout: 30_000, maxRetries: 1 })` for these checks, and `renderVerdict` already treats a throw as "passes", so a timeout degrades gracefully.

5. **src/lib/storage.ts:52-62 (used by index.ts:236, 243, 288 and kling.ts:99) — breaks (hangs).** The S3Client has no request/connection timeout; a stalled bucket read of the body photo or a garment stalls the job forever, with the same symptom as 4. Fix: `requestHandler: new NodeHttpHandler({ requestTimeout: 20_000, connectionTimeout: 5_000 })`.

6. **src/lib/tryon/google.ts:22-31 — note, not a bug.** `fetchWithBackoff` re-uses the one `AbortSignal.timeout(90_000)` created with `init`, so the 4 tries on 429/503 share a single 90 s budget (waits 1.5 + 3 + 6 s). Acceptable, but a `TimeoutError` (a DOMException, not an `Error` subclass the mirror knows) escapes index.ts:256-260 as the generic failure. Fix: catch `e.name === "TimeoutError"` and say "Google took too long".

7. **src/lib/tryon/fashn.ts, src/lib/tryon/kling.ts — fine.** Run 30 s, status 30 s per poll, 2 s poll, 180 s deadline, linked picture 30 s; Kling deletes both bucket objects in `finally` (kling.ts:138). Only nit: kling.ts:71's `/cloth|garment|image|url|download|fetch/i` turns any Kling message containing "image" into "could not read one of the pictures", which can mislabel a server-side failure.

8. **src/lib/tryon/kling.ts:96-100 — unsafe (residual).** The adult's body picture is put in the bucket under a presigned public GET for 15 minutes and removed in `finally`; if the process is killed mid-task (deploy, OOM) the object stays forever under `tryon/<personId>/` with no TryOn row, and the URL stays live for 15 minutes. Same orphaning for every `deleteMany` of TryOn rows (index.ts:84 `forgetTryOns`, index.ts:222 `fresh`, mannequin.ts:58): rows go, pictures stay. Fix: delete the objects alongside the rows and add a nightly sweep of `tryon/`/`mannequin/` keys without a row.

9. **src/lib/looks/service.ts:163-172 — slow + step line not honest.** `lookGarments` fetches each store picture serially with a 12 s timeout each (shop/page.ts:100) inside the job, before any step is reported, so for a look with several store finds the sheet can sit on "Getting ready…" for up to a minute. Path: a look built from Looking-for finds, "See it on a mannequin". Fix: `Promise.all` the fetches and report `step("Fetching the store pictures…")` (the job's `step` is in scope at actions.ts:82-83).

10. **src/lib/looks/service.ts:167-168, 173-175 — dead-end.** A store picture that fails to fetch (or an `imageKey` that is gone) is skipped silently; the mirror dresses fewer pieces and nothing under the picture says which piece is missing or why. Fix: collect the skipped titles and return them for `note`.

### The sequence of model calls, and what is wasted

11. **src/lib/tryon/index.ts:268-288 — wrong (and the "not me" root).** When the render check fails, Gemini repaints the *body photo* with the garments (`dressPrompt`, relaxed), and if the garments-only check passes, `person = again` replaces the engine's picture. Nothing records that this is a repaint: `pack()` has no flag, the TryOn row has no column, the status line (mirror-sheet.tsx:123) says "On you", and for admins "dressed by FASHN" even when Gemini replaced FASHN's picture. Path: any dressing whose first check fails. Fix: never substitute a repaint silently; either keep the engine's picture plus the note, or store `repainted: true` and say "re-drawn by the image model" under it (and `engine: "gemini"` for the admin line).

12. **src/lib/tryon/index.ts:293-305 with the seeded defaults — slow + wrong.** Because the default wear options carry prompts, every top+bottom look gets a Gemini styling pass and a third Claude check by default; the person never asked for a restyle, and the picture shown by default (line 231 looks up the styled row first) is a Gemini repaint of the try-on. Path: any "See it on me" with a top and a bottom. Fix: give the default option of each group and the default pose an empty prompt so `instructions` is empty and the plain try-on is shown until a chip is tapped.

13. **src/lib/tryon/index.ts:304 — slow.** `garmentImages(ids, …)` runs a second time to check the styled picture: another `item.findMany`, every garment downloaded from S3 again, and any photo with `wholeGarment === null` sent to Claude again. `dressed` is already in scope on the fresh path. Fix: keep the garments from the first pass (fetch lazily once when `raw` was cached).

14. **src/lib/tryon/index.ts:300-302 and 305 — slow (repeats every open).** When the styling pass throws or the styled picture fails its check, nothing is saved, so the next open of the same look pays the Gemini call and the check again and fails the same way. Path: a look whose styled picture keeps failing; every tap of "See it on me" is 20 s slower than the cached raw. Fix: save a row with `styling: key` pointing at the raw's bucketKey (or a `stylingFailed` marker) so the cache lookup at line 231 answers.

15. **src/lib/tryon/index.ts:237 vs 293 — slow (minor).** With a cached raw and no styling instructions, the raw picture is downloaded from S3 at 237 and never used (293 returns the row). Fix: download only when `styling.instructions.length`.

16. **src/lib/tryon/index.ts:240 and src/lib/looks/service.ts:176 — wrong + slow.** `garmentImages` fetches up to three closet garments (S3 reads, possible Claude whole-garment checks) and then `[...extras, …].slice(0, 3)` may throw them away in favour of store finds; and extras are never filtered by category, so a store find read as "Accessories" or a bag goes to the try-on engine (FASHN gets `category: "auto"`) and takes one of the three slots. Fix: skip extras whose `category` is known and not in `MIRROR_CATEGORIES`, and pass `MAX_GARMENTS - extras.length` as the budget to `garmentImages`.

17. **src/lib/tryon/index.ts:364 (Compare) — slow + unsafe to quota.** Each engine's `tryOnLook` independently runs `garmentImages` (3× the S3 reads; three concurrent whole-garment checks race on the same `wholeGarment === null` photo), its own render check, its own Gemini second dressing and its own Gemini styling pass plus check: three engines ≈ 6 Gemini calls and 6-9 Claude calls per Compare, which is how a 429 lands and `holdUntil` (google-image.ts:74) switches styling off for everyone for five minutes. Fix: fetch garments once in `dressOnMe` and pass them down; run the styling pass once, on the kept column, not on every candidate.

18. **src/lib/tryon/mannequin.ts:38 → src/lib/storage.ts:113 — slow (minor).** `objectExists` in S3 mode is a full `getObject`, so the shared mannequin base is downloaded twice per mannequin dressing. Fix: `try { return (await getObject(KEY)).body } catch (NotFoundError) { make it }`.

19. **src/lib/tryon/google.ts:77, src/lib/tryon/fashn.ts:85 — knob, not a bug.** `baseSteps` 50 (Google's default 32) and `FASHN_MODE=quality` are the owner's "quality over speed" choices; together they are a good third of the wait. Worth knowing for a demo.

### Honesty of the step line and the status line

20. **src/components/mirror/mirror-sheet.tsx:120 — wrong.** "Usually 20 to 60 seconds" against the real 80-110 s sequence. Fix the sequence (1, 3, 12, 13) or the sentence.

21. **src/lib/tryon/index.ts:277 — wrong wording.** `step("Dressing again…")` while a different model (Gemini image) repaints the body photo; the person reads it as the same engine having another go. Fix: "Re-drawing the picture…" and mark the result (11).

22. **src/components/mirror/mirror-sheet.tsx:114-116 — wrong on phones.** In Compare the step is one string, "Google · Dressing you · Oxford   FASHN · starting…   Kling · …" (index.ts:363), rendered in a single `mono tracking-[0.18em]` span with no wrap or `truncate` inside an `overflow-hidden` box: it is clipped on a 390 px screen. Fix: `truncate` plus `title`, or one line per engine.

23. **src/lib/tryon/index.ts:339 — wrong (minor).** `keepTryOn` returns the kept row with `styling` recomputed from the person's *current* prefs, not the row's `styling` key, so the summary line under the kept picture can name a tuck or pose the picture does not show. Fix: resolve the summary from `row.styling`.

### Job lifecycle and the client polling loop

24. **src/components/mirror/use-mirror.ts:55-61 — dead-end (busy forever).** `settle` re-arms the 2 s poll with no deadline and no failure count; on a network error it re-polls the same `pending` forever. Combined with 4 and 5, the sheet can show a climbing counter and "Usually 20 to 60 seconds" indefinitely, every button disabled. Fix: a client deadline (e.g. 4 min, or after N failed polls) that sets `error` with "Taking too long. Try again" and clears `busy`.

25. **src/lib/jobs.ts:9-10, 20-23 + src/app/(app)/mirror/actions.ts:96-100 — wrong wording after a restart.** Jobs are in-process; a deploy or restart mid-dressing, or a phone away more than `KEEP_MS` (10 min), makes the next poll answer "That dressing is gone. Try again." The work in flight is lost (credits spent), but the finished picture is often already a TryOn row, so "gone" is misleading. What the screen shows: the red banner plus a "Try again" pill (mirror-sheet.tsx:92-96), which then usually answers from cache in under 1.5 s. Fix: on this exact error the hook should re-issue `dress` once by itself and only then show the banner.

26. **src/components/mirror/use-mirror.ts:55, 71 — wrong (minor).** The seconds restart from zero whenever `dress` runs for a look whose job is already running (re-open while busy, a second tap), because `startedAt` is the phone's `Date.now()` and `r.pending.startedAt` is ignored. Fix: keep the first client stamp per `jobId`.

27. **src/components/mirror/use-mirror.ts:89 — wrong (minor).** `show` while `busy` for the same look dresses again (joins the job) instead of just reopening the sheet, which is what resets the counter in 26. Fix: `if (busy && look && sameLook) { setOpen(true); return; }`.

28. **src/components/mirror/use-mirror.ts:132-140 — wrong (low).** `keep` does not check `seq` after the await, so a dressing started meanwhile could be overwritten by the kept picture; today the buttons are disabled while busy, so it needs a close-and-reopen to hit.

29. **State machine otherwise sound.** Every `dress` ends in `settle`, which always clears `busy` on `ok:false`/`tryOn` and surfaces `error`; `begin` bumps `seq` and clears busy/error; unmount bumps `seq` and clears the timer (use-mirror.ts:49); `confirm`, `swap`, `redo`, `switchTo`, `restyle` all funnel into `dress`. The only path where `busy` never clears is 24.

### Caching keys: needless re-dressing, stale pictures

30. **Keys are right.** Raw: `(personId, bodyPhotoKey, sorted itemIds + extra keys, engine, styling null)`; styled: same + `styling.key`; mannequin: `(personId, MANNEQUIN_BASE_KEY, ids, styling.key)`; `source` is deliberately not in the key so Today/closet/look share pictures; a photo change forgets via `forgetTryOns`; a new body photo is a new key. `TryOnChoice.lookKey` is built identically in `keepTryOn` and `keptEngine` (sorted, extras included). No stale-picture path found. The avoidable re-work is 12-14 (styling repeats) and 16 (a store find re-added gets a new `look-piece:` id, so a look is re-dressed; acceptable).

31. **src/lib/tryon/index.ts:389-393 — dead-code.** `listTryOns` is called only from tests; no screen lists past pictures.

### Compare

32. **src/lib/tryon/index.ts:366-368 + src/components/mirror/mirror-sheet.tsx:126 — dead-end for the family.** When one engine fails in Compare the reason goes into `engineNote`, which renders only for admins; a non-admin sees "Option 1 / Option 2" with a column missing and no word. Fix: show the failure line to everyone, worded without the engine name if that is the intent.

33. **src/lib/tryon/index.ts:364 — fine.** `Promise.allSettled`; one engine failing leaves the others; both failing re-throws the first reason; "Keep this one" (`keepTryOn`) asserts readiness and ownership and clears on "Dress again" (fresh deletes the choice at 357). Covered by tests/outfits/tryon.test.ts:103-131.

### Minors: can the guard be bypassed?

34. **Proof that a minor's body photo never reaches a provider.** Every provider call that takes a body photo (`googleTryOn`, `fashnTryOn`, `klingTryOn`, the relaxed `googleImage` at index.ts:280 and 299) is reachable only inside `tryOnLook`, whose first statement is `assertReady(viewer, personId)` (index.ts:201) → `tryOnState` (120-128), which returns `not_you` when `viewer.id !== personId` and `minor` when the person's role is minor, before any `bodyPhoto` row is read. Callers of `tryOnLook`: `dressOnMe` (every branch ends in `tryOnLook`), the shop's `tryOnLookupAction` (gated on `tryOnState === "ready"`, else the mannequin, else `tryOnLook` which throws), and tests. `keepTryOn` calls `assertReady` first. The mannequin path (`mannequinLook`) sends garments only, never a body photo and never `relaxed`; `assertCanDress` admits the person or a guardian. The UI never offers "on me" for a minor or to a parent (`onMe = mine && tryOn === "ready"` in look-screen.tsx:40; `mirror.tryOn === "ready"` in item-editor/closet-grid; `p.tryOn === "ready"` on Today), and `photoRow` hides Retake unless `ready`/`no_photo`. Served pictures: `/api/photo` → `canViewKey` returns owner-only for `tryon/` (photos/visibility.ts:26) and person-or-guardian for `mannequin/<personId>` (visibility.ts:59-64). A minor may hold body photos with parental approval (`bodyPhotosAllowed`), but `tryOnState` returns `minor` before `no_photo`, so they are never dressed. **No bypass found.**

35. **src/lib/tryon/index.ts:357 and 361 — unsafe (cross-member writes, Compare only).** In `dressOnMe`, when the rule is Compare and no engine was kept, `db.tryOnChoice.deleteMany({ personId, lookKey })` (fresh) and `stylingFor(personId, ids, pick)` → `savePrefs` run **before** any `assertReady`; `personId` comes straight from the client (`req.personId`, actions.ts:87). Any signed-in member can clear another member's kept engine for a look or overwrite their `Person.mirrorPrefs` (tuck, pose). No body photo is involved and `bodyPhotoKeyFor` reads only a key, not bytes. Fix: call `assertReady(viewer, personId)` at the top of `dressOnMe`.

36. **src/app/(app)/mirror/actions.ts:59-63 — wrong (low).** `lookItemIds` for a closet look checks only that the ids exist and are not retired, not that the viewer may browse them, so a member can dress themselves in any item id in the database (clothes only; `garmentImages` excludes `worn` and `label` kinds at index.ts:165, so no photo of a minor wearing a piece goes out). Fix: require the items to be in the viewer's closet or the family closet, as `addPieces` does (service.ts:95).

37. **src/components/mirror/mirror-sheet.tsx:72 — unsafe (privacy, adults).** "Retake" always calls `addBodyPhotoAction(personId, key, false, view)`: `onlyMe=false`. A person whose body photos are all locked "only me" takes a new one in the mirror and it becomes visible to anyone with a body-data grant, with no choice offered (the Body page offers one). Fix: inherit `onlyMe` from the newest photo of that view, or default to `true`.

### iOS Safari specifics in the client components

38. **src/components/mirror/mirror-sheet.tsx:106, 112 — wrong (flash of the old picture).** The `<img>` has no `key` and no load handling; when `t.key` changes React only swaps `src`, and WebKit keeps painting the previous bitmap until the new JPEG arrives through the proxy, while `opacity-40` is removed and the caption/summary already describe the new look: for a second the *old* picture shows at full opacity as the new one. Fix: `key={t.key}`, `decoding="async"`, and keep the dim (or a placeholder) until `onLoad`.

39. **src/components/mirror/mirror-sheet.tsx:100-110 — wrong on phones.** Compare uses `grid-cols-3` inside a fixed `h-[460px]` box: ~115 px columns on an iPhone, three "Keep this one" pills squeezed under thumbnails too small to judge. Fix: a horizontal scroller of full-width columns, or stack with the kept engine first.

40. **src/components/mirror/mirror-sheet.tsx:66-69 — dead-end.** The signed PUT of the retaken photo has no timeout; on a dropped cellular connection the button says "Saving…" for good (`saving` is only cleared by the promise settling). Fix: `AbortSignal.timeout(60_000)` and surface the error.

41. **src/components/ui/sheet.tsx:35, 47 + src/app/globals.css:121-129 — already fixed / residual.** `flex-auto` is in place. `max-h-[90dvh]` is right for iOS; the fixed `h-[460px]` image box means on an iPhone SE "Dress again", the view row and the chips are below the fold with no pinned footer (the pending state has one, the picture state does not). `html.sheet-open{overflow:hidden}` does not stop touch-scrolling of the page under a modal dialog on iOS; `overscroll-behavior: contain` on the dialog helps on iOS 16+. Low.

42. **src/components/mirror/mirror-sheet.tsx:138, 160, 261 — dead-end (soft).** View, chip and swap buttons are `disabled` while busy; a tap does nothing. The progress bar is on screen so it is tolerable, but on iOS a disabled pill has no visual change unless `pill` styles `:disabled`.

43. **src/components/mirror/mirror-sheet.tsx:168 — wrong (minor).** `GoWithRows` unmounts while busy, so after a swap tap the rows the person was looking at vanish and the sheet shortens, then reappear.

44. **src/components/looks/look-tray.tsx:213 — fine.** `position: fixed` with `bottom: calc(76px + env(safe-area-inset-bottom))`, under the dialog's top layer.

### Looks

45. **src/app/(app)/looks/[lookId]/look-screen.tsx:45-48 — dead-end (busy forever).** `run()` sets `busy` then `await fn()` inside `startTransition`; if the server action rejects (network drop) `setBusy(null)` is skipped and every button on the screen stays disabled with no message. Fix: `try { … } catch { toast.error(…) } finally { setBusy(null) }`.

46. **src/app/(app)/looks/[lookId]/look-screen.tsx:86 vs mirror-sheet.tsx:86 — wrong (minor).** On the look screen `useMirror` has no wardrobe, so the pieces line under the picture is the screen's `names`; after a failed dressing of a changed look, the previous picture sits under the new names.

47. **src/lib/looks/service.ts:102 — wrong (minor).** Duplicate detection for store finds uses `url` or `imageKey`; a find with only `imageUrl` can be added twice.

48. **src/lib/looks/service.ts:45 vs 91 and look-screen.tsx:43 — wrong (edge).** `toView` hides pieces whose item was retired but `addPieces` counts them toward `MAX_LOOK_PIECES`, so the screen can say "4 of 5", offer "Pick up to 1", and the server answer "A look holds up to 5 pieces. Take one out first." with nothing visible to take out.

49. **src/lib/looks/service.ts:62-64 — wrong (race).** Two "Add to a look" taps from different screens with no open look can create two open looks; the tray shows the newer, the other resurfaces when the first is saved.

50. **src/app/(app)/looks/[lookId]/look-screen.tsx:73 — wrong wording.** "The mirror dresses up to three of them: a top, a bottom, shoes" — the real pick is the first three by category order (Tops, Dresses, Bottoms, Shoes, Outerwear) after a stable sort (index.ts:240), so two tops + jeans + sneakers dresses both tops and drops the shoes.

51. **src/lib/tryon/complete.ts:155-159 — dead-code.** `SLOT_WORD[*].ask` and `.skip` are used only by tests since the one-panel redesign; `label` and `none` are what the panel renders.

### Dead ends, collected (a tap with no feedback)

- 10 (a store find silently missing from the picture), 24 (poll loop never ends), 32 (a Compare column missing without a word for non-admins), 40 (Retake "Saving…" forever), 45 (look screen frozen after a failed action), 42 (disabled pills while busy, soft). Everything else that can fail shows the red banner with "Try again" (mirror-sheet.tsx:92-96) or a toast.

## 2. What the tests do and do not cover

- **tests/outfits/tryon.test.ts (263 lines):** eligibility states and 403s, caching per look/engine/view, shoes-left-out note, Compare with Kling missing and with all three, Keep → shown alone → "Dress again" compares afresh, a stand-in engine with its note, step reporting, styling defaults/cache/remembered picks, garment photo ranking and whole-garment skips, `fresh` and `forgetTryOns`, the render-fail note (`MOCK_RENDER_OK=false`). **Not covered:** the second dressing *succeeding* and replacing the picture (finding 11); `stylingFailed`; the `googleImageOnHold` skip inside the mirror; Compare with one engine *throwing* (engineNote with a failure); the pre-`assertReady` writes in the Compare branch (35); a minor or a non-owner through `dressOnMe`/`dressAction` (only `tryOnState`/`setTryOnEnabled` are asserted); `noteBodyPhotoProblem` set and cleared; `keepTryOn`'s summary.
- **tests/outfits/fashn.test.ts (107):** full client incl. moderation/pose/key/credits/timeout/no-key and `resolveEngines`. **Not covered:** 429 backoff on run/status, 5xx on a status poll.
- **tests/outfits/kling.test.ts (134):** auth forms, token, body shape, polling, picture rules, every failure code, object cleanup. Good.
- **tests/outfits/complete.test.ts (53):** the pure slot rules. Good. (`tests/outfits/google-filters.test.ts`, outside the list, covers the level fallbacks and the 429 hold.)
- **e2e (mirror-complete 110, tryon 107, looks 72):** happy paths only, with every provider mocked and fast, so `settled(job, 1500)` answers in the first call and **the 2 s polling loop, the "pending" sheet state, the error banner, "Try again" and "That dressing is gone" are never exercised end-to-end**. Both Playwright projects are **Chromium** (`playwright.config.ts:19-20`, "iphone" = iPhone 15 viewport on Chromium): no WebKit run, which is how the empty sheet shipped. No e2e for "See it on me" with a look holding store finds, for Retake privacy, for a minor or a parent on the look page, or for Compare with a failing engine.

## 3. Files read (line counts)

src/lib/tryon/index.ts 393 · google.ts 101 · fashn.ts 121 · kling.ts 146 · engines.ts 36 · config.ts 23 · mannequin-key.ts 3 · features.ts 114 · garment-check.ts 49 · styling.ts 41 · wardrobe.ts 34 · mannequin.ts 77 · complete.ts 82
src/lib/looks/service.ts 180 · shared.ts 28
src/components/mirror/mirror-sheet.tsx 287 · use-mirror.ts 146
src/components/looks/add-to-look.tsx 41 · look-tray.tsx 20
src/app/(app)/mirror/actions.ts 107
src/app/(app)/looks/actions.ts 60 · [lookId]/look-screen.tsx 119 · [lookId]/page.tsx 27 · new/page.tsx 13
tests/outfits/tryon.test.ts 263 · fashn.test.ts 107 · kling.test.ts 134 · complete.test.ts 53
e2e/mirror-complete.spec.ts 110 · tryon.spec.ts 107 · looks.spec.ts 72
prisma/schema.prisma: TryOn 815-833, TryOnChoice 836-846, BodyPhoto 616-629, Look 643-658, LookPiece 661-680, MirrorPose 1081-1090, WearGroup 1093-1103, WearOption 1105-1116 (of 1116)
Dependencies read to verify: src/lib/jobs.ts 75 · src/lib/images/google-image.ts 83 · src/lib/storage.ts 169 · src/lib/ai/claude.ts 1-66 · src/components/ui/sheet.tsx 51 · src/lib/photos/visibility.ts 1-90 · src/lib/people/visibility.ts 40-80 · src/app/api/photo/[...key]/route.ts 26 · src/app/(app)/shop/actions.ts 100-130 · src/lib/profiles/service.ts 112-119 · src/app/(app)/profile/actions.ts 36-42 · playwright.config.ts 18-27 · globals.css 118-129 · button.tsx (props) · rules-kind.ts / seed-data.ts (mirrorEngine default = fashn).
